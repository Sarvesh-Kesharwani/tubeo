import 'server-only';

const DEFAULT_TABLE = 'tubeo_yt_cache';

export interface YtCacheReadEntry {
  cacheKey: string;
  path: string;
  params: Record<string, string>;
  data: unknown;
  cachedDate: string;
  fetchedAt: string;
}

export interface YtCacheWriteEntry {
  cacheKey: string;
  path: string;
  params: Record<string, string>;
  data: unknown;
  cachedDate: string;
}

interface SupabaseRow {
  cache_key: string;
  path: string;
  params: Record<string, string>;
  data: unknown;
  cached_date: string;
  fetched_at?: string;
  updated_at?: string;
}

function config(): { url: string; key: string; table: string } | null {
  const url = process.env.TUBEO_SUPABASE_URL?.trim();
  const key =
    process.env.TUBEO_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_SECRET_KEY?.trim();
  const table = process.env.TUBEO_SUPABASE_YT_CACHE_TABLE?.trim() || DEFAULT_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, table };
}

export function isSupabaseYtCacheConfigured(): boolean {
  return Boolean(config());
}

function headers(key: string, accept: 'json' | 'minimal' = 'json') {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(accept === 'minimal' ? { Prefer: 'return=minimal' } : {}),
  };
}

function tableUrl(baseUrl: string, table: string): string {
  return `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
}

/**
 * Returns the cached row if it exists AND is from `today` (IST). Older rows
 * are ignored so they don't accidentally serve stale data.
 */
export async function readYtCache(
  cacheKey: string,
  today: string,
): Promise<YtCacheReadEntry | null> {
  const cfg = config();
  if (!cfg) return null;

  const qs = new URLSearchParams({
    cache_key: `eq.${cacheKey}`,
    cached_date: `eq.${today}`,
    select: 'cache_key,path,params,data,cached_date,fetched_at',
    limit: '1',
  });
  let res: Response;
  try {
    res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
      headers: headers(cfg.key),
      cache: 'no-store',
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const rows = (await res.json().catch(() => [])) as SupabaseRow[];
  const row = rows[0];
  if (!row) return null;

  return {
    cacheKey: row.cache_key,
    path: row.path,
    params: row.params ?? {},
    data: row.data,
    cachedDate: row.cached_date,
    fetchedAt: row.fetched_at || new Date(0).toISOString(),
  };
}

export async function writeYtCache(entry: YtCacheWriteEntry): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  const row: SupabaseRow = {
    cache_key: entry.cacheKey,
    path: entry.path,
    params: entry.params,
    data: entry.data,
    cached_date: entry.cachedDate,
    fetched_at: new Date().toISOString(),
  };
  const qs = new URLSearchParams({ on_conflict: 'cache_key' });
  try {
    await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
      method: 'POST',
      headers: {
        ...headers(cfg.key, 'minimal'),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
      cache: 'no-store',
    });
  } catch {
    // Best-effort write. The in-memory L1 still serves this request.
  }
}

/**
 * Deletes today's cache entries so the next request forces a live fetch.
 * Returns the number of rows deleted, or null if Supabase isn't configured.
 */
export async function clearYtCacheForDate(today: string): Promise<number | null> {
  const cfg = config();
  if (!cfg) return null;

  const qs = new URLSearchParams({ cached_date: `eq.${today}` });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'DELETE',
    headers: { ...headers(cfg.key), Prefer: 'return=representation,count=exact' },
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase yt-cache delete failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await res.json().catch(() => [])) as unknown[];
  return Array.isArray(rows) ? rows.length : null;
}

/**
 * Removes stale rows (cached_date < today) to keep table size bounded.
 * Safe to call from the daily cron.
 */
export async function pruneStaleYtCache(today: string): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  const qs = new URLSearchParams({ cached_date: `lt.${today}` });
  try {
    await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
      method: 'DELETE',
      headers: headers(cfg.key, 'minimal'),
      cache: 'no-store',
    });
  } catch {
    // Best-effort cleanup.
  }
}
