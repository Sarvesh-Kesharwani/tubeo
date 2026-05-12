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
  total: number;
  videos: SavedVideo[];
}

export interface LinkNestDeleteResult {
  deleted: number;
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
  const existingIds = new Set(current.map((video) => video.id));
  const existingUrls = new Set(current.map((video) => video.url));
  const imported: SavedVideo[] = [];
  let skipped = 0;

  for (const row of rows) {
    const rawUrl = (row.canonical_url || row.original_url || '').trim();
    const resolved = resolveSavedVideoFromUrl(rawUrl);
    if (!resolved) {
      skipped += 1;
      continue;
    }

    if (existingIds.has(resolved.id) || existingUrls.has(resolved.url)) {
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
    });
  }

  return {
    imported,
    skipped,
    total: rows.length,
    videos: [...imported, ...current],
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

export async function deleteLinkNestSavedLink(rawUrl: string): Promise<LinkNestDeleteResult> {
  const { url, key, table } = getLinkNestConfig();
  const candidates = linkNestDeleteUrlCandidates(rawUrl);
  if (candidates.length === 0) return { deleted: 0 };
  const clauses = candidates.flatMap((candidate) => [
    `canonical_url.eq.${candidate}`,
    `original_url.eq.${candidate}`,
  ]);
  const qs = new URLSearchParams({
    or: `(${clauses.join(',')})`,
  });

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
  return { deleted: Array.isArray(deletedRows) ? deletedRows.length : 0 };
}
