import 'server-only';

import {
  normalizeSavedVideoCategory,
  type SavedVideo,
} from './saved-videos-shared';
import type { TubeoUserIdentity } from './supabase-sync';

const DEFAULT_TABLE = 'tubeo_saved_videos';

interface SupabaseSavedVideoRow {
  owner_key: string;
  user_email: string;
  user_name: string | null;
  videos: SavedVideo[];
  videos_updated_at: string;
  updated_at?: string;
}

export interface SupabaseSavedVideosPayload {
  videos: SavedVideo[];
  updatedAt: string;
}

function config(): { url: string; key: string; table: string } | null {
  const url = process.env.TUBEO_SUPABASE_URL?.trim();
  const key =
    process.env.TUBEO_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_SECRET_KEY?.trim();
  const table = process.env.TUBEO_SUPABASE_SAVED_VIDEOS_TABLE?.trim() || DEFAULT_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, table };
}

export function isSupabaseSavedVideosConfigured(): boolean {
  return Boolean(config());
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function tableUrl(baseUrl: string, table: string): string {
  return `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
}

function normalizeVideos(videos: SavedVideo[]): SavedVideo[] {
  const seen = new Set<string>();
  const out: SavedVideo[] = [];
  for (const item of videos) {
    const id = item?.id?.trim();
    const url = item?.url?.trim();
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      url,
      note: typeof item.note === 'string' ? item.note.trim() : '',
      category: normalizeSavedVideoCategory(item.category),
      addedAt: item.addedAt || new Date().toISOString(),
      ...(item.source === 'linknest' ? { source: 'linknest' as const } : {}),
      ...(typeof item.linkNestId === 'string' && item.linkNestId.trim()
        ? { linkNestId: item.linkNestId.trim() }
        : {}),
    });
  }
  return out;
}

export async function readSupabaseSavedVideos(
  identity: TubeoUserIdentity,
): Promise<SupabaseSavedVideosPayload | null> {
  const cfg = config();
  if (!cfg) return null;

  const qs = new URLSearchParams({
    owner_key: `eq.${identity.ownerKey}`,
    select: 'owner_key,user_email,user_name,videos,videos_updated_at,updated_at',
    limit: '1',
  });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    headers: headers(cfg.key),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase saved-videos read failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await res.json()) as SupabaseSavedVideoRow[];
  const row = rows[0];
  if (!row) return null;

  return {
    videos: normalizeVideos(row.videos ?? []),
    updatedAt: row.videos_updated_at || row.updated_at || new Date(0).toISOString(),
  };
}

export async function writeSupabaseSavedVideos(
  identity: TubeoUserIdentity,
  videos: SavedVideo[],
): Promise<SupabaseSavedVideosPayload> {
  const cfg = config();
  if (!cfg) throw new Error('Tubeo Supabase saved-videos sync is not configured.');

  const normalized = normalizeVideos(videos);
  const updatedAt = new Date().toISOString();
  const row: SupabaseSavedVideoRow = {
    owner_key: identity.ownerKey,
    user_email: identity.email,
    user_name: identity.name,
    videos: normalized,
    videos_updated_at: updatedAt,
  };
  const qs = new URLSearchParams({ on_conflict: 'owner_key' });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'POST',
    headers: {
      ...headers(cfg.key),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase saved-videos write failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await res.json()) as SupabaseSavedVideoRow[];
  const returned = rows[0];
  return {
    videos: normalizeVideos(returned?.videos ?? normalized),
    updatedAt: returned?.videos_updated_at || returned?.updated_at || updatedAt,
  };
}
