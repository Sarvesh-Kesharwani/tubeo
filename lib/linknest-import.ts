import {
  parseYouTubeVideoId,
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

function getLinkNestConfig() {
  const url = process.env.LINKNEST_SUPABASE_URL?.trim();
  const key = process.env.LINKNEST_SUPABASE_KEY?.trim();
  const table = process.env.LINKNEST_SUPABASE_TABLE?.trim() || DEFAULT_LINKNEST_TABLE;
  if (!url || !key) {
    throw new Error('LINKNEST_SUPABASE_URL and LINKNEST_SUPABASE_KEY are required.');
  }
  return { url: url.replace(/\/$/, ''), key, table };
}

export async function fetchLinkNestYouTubeLinks(): Promise<LinkNestRow[]> {
  const { url, key, table } = getLinkNestConfig();
  const qs = new URLSearchParams({
    select: 'id,platform,canonical_url,original_url,note,created_at',
    platform: 'eq.youtube',
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
    const videoId = parseYouTubeVideoId(rawUrl);
    if (!videoId) {
      skipped += 1;
      continue;
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    if (existingIds.has(videoId) || existingUrls.has(url)) {
      skipped += 1;
      continue;
    }

    existingIds.add(videoId);
    existingUrls.add(url);
    imported.push({
      id: videoId,
      url,
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
