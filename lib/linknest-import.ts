import {
  parseYouTubeVideoId,
  resolveSavedVideoFromUrl,
  type SavedVideo,
} from './saved-videos';
import { UNCATEGORIZED_SAVED_CATEGORY } from './saved-videos-shared';

const DEFAULT_LINKNEST_TABLE = 'saved_links';
const IMPORT_LIMIT = 200;

interface LinkNestRow {
  id: string;
  platform: 'instagram' | 'youtube' | 'webpage' | 'unknown';
  canonical_url: string | null;
  original_url: string | null;
  note: string | null;
  created_at: string | null;
}

export interface LinkNestImportResult {
  imported: SavedVideo[];
  skipped: number;
  updated: number;
  total: number;
  videos: SavedVideo[];
}

export interface LinkNestDeleteResult {
  deleted: number;
  archived: number;
}

function getLinkNestConfig() {
  const url = process.env.LINKNEST_SUPABASE_URL?.trim();
  const key = process.env.LINKNEST_SUPABASE_KEY?.trim();
  const table = process.env.LINKNEST_SUPABASE_TABLE?.trim() || DEFAULT_LINKNEST_TABLE;
  if (!url || !key) {
    throw new Error('LINKNEST_SUPABASE_URL and LINKNEST_SUPABASE_KEY are required.');
  }
  return { url: url.replace(/\/$/, ''), key, table };
}

export async function fetchLinkNestSavedLinks(): Promise<LinkNestRow[]> {
  const { url, key, table } = getLinkNestConfig();
  const qs = new URLSearchParams({
    select: 'id,platform,canonical_url,original_url,note,created_at',
    note_status: 'in.(added,skipped,pending)',
    order: 'created_at.desc',
    limit: String(IMPORT_LIMIT),
  });

  const res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${qs}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkNest import failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  return (await res.json()) as LinkNestRow[];
}

export function importLinkNestRows(current: SavedVideo[], rows: LinkNestRow[]): LinkNestImportResult {
  const nextVideos = current.map((video) => ({ ...video }));
  const existingIds = new Set(current.map((video) => video.id));
  const existingUrls = new Set(current.map((video) => video.url));
  const imported: SavedVideo[] = [];
  let skipped = 0;
  let updated = 0;

  for (const row of rows) {
    const rawUrl = (row.canonical_url || row.original_url || '').trim();
    const resolved = resolveSavedVideoFromUrl(rawUrl);
    if (!resolved) {
      skipped += 1;
      continue;
    }

    if (existingIds.has(resolved.id) || existingUrls.has(resolved.url)) {
      const existing = nextVideos.find((video) => video.id === resolved.id || video.url === resolved.url);
      if (existing && (existing.source !== 'linknest' || existing.linkNestId !== row.id)) {
        existing.source = 'linknest';
        existing.linkNestId = row.id;
        updated += 1;
      }
      skipped += 1;
      continue;
    }

    existingIds.add(resolved.id);
    existingUrls.add(resolved.url);
    imported.push({
      id: resolved.id,
      url: resolved.url,
      note: row.note?.trim() || 'Saved from LinkNest',
      category: UNCATEGORIZED_SAVED_CATEGORY,
      addedAt: row.created_at || new Date().toISOString(),
      source: 'linknest',
      linkNestId: row.id,
    });
  }

  return {
    imported,
    skipped,
    updated,
    total: rows.length,
    videos: [...imported, ...nextVideos],
  };
}

function linkNestDeleteUrlCandidates(rawUrl: string): string[] {
  const candidates = new Set<string>();
  const trimmed = rawUrl.trim();
  if (trimmed) candidates.add(trimmed);

  const resolved = resolveSavedVideoFromUrl(trimmed);
  if (resolved) candidates.add(resolved.url);

  const videoId = parseYouTubeVideoId(trimmed);
  if (videoId) {
    candidates.add(`https://www.youtube.com/watch?v=${videoId}`);
    candidates.add(`https://youtu.be/${videoId}`);
  }

  return [...candidates];
}

function getLinkNestMatchQuery({
  linkNestId,
  rawUrl,
}: {
  linkNestId?: string;
  rawUrl?: string;
}): URLSearchParams {
  const cleanId = linkNestId?.trim();
  if (cleanId) return new URLSearchParams({ id: `eq.${cleanId}` });

  const candidates = rawUrl ? linkNestDeleteUrlCandidates(rawUrl) : [];
  if (candidates.length === 0) return new URLSearchParams();

  return new URLSearchParams({
    or: `(${candidates
      .flatMap((candidate) => [
        `canonical_url.eq.${candidate}`,
        `original_url.eq.${candidate}`,
      ])
      .join(',')})`,
  });
}

export async function removeLinkNestSavedLink({
  linkNestId,
  rawUrl,
}: {
  linkNestId?: string;
  rawUrl?: string;
}): Promise<LinkNestDeleteResult> {
  const { url, key, table } = getLinkNestConfig();
  const qs = getLinkNestMatchQuery({ linkNestId, rawUrl });
  if (!qs.toString()) return { deleted: 0, archived: 0 };

  const res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${qs}`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      Prefer: 'return=representation',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkNest delete failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const deletedRows = (await res.json().catch(() => [])) as unknown[];
  const deleted = Array.isArray(deletedRows) ? deletedRows.length : 0;
  if (deleted > 0) return { deleted, archived: 0 };

  const archivedRes = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${qs}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      platform: 'unknown',
      original_url: `removed-from-tubeo:${linkNestId || rawUrl || 'unknown'}`,
      canonical_url: `removed-from-tubeo:${linkNestId || rawUrl || 'unknown'}`,
      note: 'Removed from Tubeo',
      note_status: 'skipped',
    }),
    cache: 'no-store',
  });

  if (!archivedRes.ok) {
    const detail = await archivedRes.text().catch(() => '');
    throw new Error(`LinkNest archive failed: ${archivedRes.status} ${detail.slice(0, 200)}`);
  }

  const archivedRows = (await archivedRes.json().catch(() => [])) as unknown[];
  return { deleted: 0, archived: Array.isArray(archivedRows) ? archivedRows.length : 0 };
}
