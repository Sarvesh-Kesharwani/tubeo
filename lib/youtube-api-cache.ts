import 'server-only';

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { istDateString } from './news-source';
import { readYtCache, writeYtCache } from './supabase-yt-cache';

const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_VERSION = 2;
const DEFAULT_MAX_ENTRIES = 2_000;

// Short L1 (in-process) TTL so a fresh deploy/page load picks up the L2 Supabase
// invalidation that the Refresh button performs. The L2 layer is authoritative.
const MEMORY_TTL_MS = 60 * 1000;

interface CacheEntry<T = unknown> {
  key: string;
  path: string;
  params: Record<string, string>;
  data: T;
  cachedDate: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

export interface YouTubeApiResult<T> {
  data: T;
  fromCache: boolean;
}

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<YouTubeApiResult<unknown>>>();
let loaded = false;
let loadPromise: Promise<void> | null = null;
let savePromise: Promise<void> = Promise.resolve();

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY missing');
  return key;
}

function cachePath(): string {
  const dir = process.env.YOUTUBE_API_CACHE_DIR?.trim() || path.join(process.cwd(), '.cache');
  return path.join(dir, 'youtube-api-cache.json');
}

function maxEntries(): number {
  const parsed = Number(process.env.YOUTUBE_API_CACHE_MAX_ENTRIES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_ENTRIES;
}

function normalizeParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function cacheKey(apiPath: string, params: Record<string, string>): string {
  const normalized = normalizeParams(params);
  return createHash('sha256').update(`${apiPath}?${new URLSearchParams(normalized).toString()}`).digest('hex');
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const raw = await readFile(cachePath(), 'utf8');
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version !== CACHE_VERSION || !parsed.entries) return;
      for (const entry of Object.values(parsed.entries)) {
        if (entry?.key && entry.path && entry.params && entry.data !== undefined) {
          memory.set(entry.key, entry);
        }
      }
    } catch {
      // Missing or unreadable cache should never block live API reads.
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function prune(): void {
  const limit = maxEntries();
  if (memory.size <= limit) return;

  const entries = [...memory.values()].sort(
    (a, b) => Date.parse(a.lastAccessedAt || a.updatedAt) - Date.parse(b.lastAccessedAt || b.updatedAt),
  );
  for (const entry of entries.slice(0, Math.max(0, memory.size - limit))) {
    memory.delete(entry.key);
  }
}

async function save(): Promise<void> {
  const file = cachePath();
  const dir = path.dirname(file);
  const payload: CacheFile = {
    version: CACHE_VERSION,
    entries: Object.fromEntries(memory),
  };

  savePromise = savePromise
    .catch(() => undefined)
    .then(async () => {
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(file, JSON.stringify(payload), 'utf8');
      } catch {
        // Production filesystems may be read-only. Memory cache still works.
      }
    });

  return savePromise;
}

async function writeEntry<T>(
  apiPath: string,
  params: Record<string, string>,
  key: string,
  data: T,
  cachedDate: string,
): Promise<void> {
  const now = new Date().toISOString();
  const previous = memory.get(key);
  memory.set(key, {
    key,
    path: apiPath,
    params: normalizeParams(params),
    data,
    cachedDate,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    lastAccessedAt: now,
  });
  prune();
  await save();
  await writeYtCache({
    cacheKey: key,
    path: apiPath,
    params: normalizeParams(params),
    data,
    cachedDate,
  });
}

async function fetchFresh<T>(
  apiPath: string,
  params: Record<string, string>,
  key: string,
  revalidate: number,
  cachedDate: string,
): Promise<YouTubeApiResult<T>> {
  const qs = new URLSearchParams({ ...normalizeParams(params), key: apiKey() }).toString();
  const res = await fetch(
    `${API}/${apiPath}?${qs}`,
    revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube ${apiPath} ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as T;
  await writeEntry(apiPath, params, key, data, cachedDate);
  return { data, fromCache: false };
}

function memoryEntryIsFresh(entry: CacheEntry | undefined, today: string): boolean {
  if (!entry) return false;
  if (entry.cachedDate !== today) return false;
  const ageMs = Date.now() - Date.parse(entry.lastAccessedAt || entry.updatedAt);
  return Number.isFinite(ageMs) && ageMs < MEMORY_TTL_MS;
}

export async function getCachedYouTubeJson<T>(
  apiPath: string,
  params: Record<string, string>,
  revalidate = 60 * 60 * 24,
): Promise<YouTubeApiResult<T>> {
  await ensureLoaded();

  const today = istDateString();
  const key = cacheKey(apiPath, params);

  // L1: in-memory, only honored if same IST day AND younger than MEMORY_TTL_MS.
  const memoryEntry = memory.get(key) as CacheEntry<T> | undefined;
  if (memoryEntry && memoryEntryIsFresh(memoryEntry, today)) {
    memoryEntry.lastAccessedAt = new Date().toISOString();
    void save();
    return { data: memoryEntry.data, fromCache: true };
  }

  // L2: Supabase. Authoritative for the day. Refresh button invalidates this.
  try {
    const remote = await readYtCache(key, today);
    if (remote) {
      const now = new Date().toISOString();
      const stored: CacheEntry<T> = {
        key,
        path: apiPath,
        params: normalizeParams(params),
        data: remote.data as T,
        cachedDate: remote.cachedDate,
        createdAt: memoryEntry?.createdAt ?? remote.fetchedAt ?? now,
        updatedAt: remote.fetchedAt ?? now,
        lastAccessedAt: now,
      };
      memory.set(key, stored);
      prune();
      void save();
      return { data: stored.data, fromCache: true };
    }
  } catch {
    // Supabase read failure should never block a live fetch.
  }

  // De-dupe concurrent live fetches for the same key inside one process.
  const existing = inflight.get(key);
  if (existing) return existing as Promise<YouTubeApiResult<T>>;

  const request = fetchFresh<T>(apiPath, params, key, revalidate, today).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request as Promise<YouTubeApiResult<unknown>>);
  return request;
}

/**
 * Clears the in-memory cache for entries from the given IST date (or all entries
 * if no date is provided). Safe to call from server actions to ensure the next
 * fetch re-checks Supabase.
 */
export function clearMemoryYtCacheForDate(today?: string): void {
  if (!today) {
    memory.clear();
    return;
  }
  for (const [key, entry] of memory) {
    if (entry.cachedDate === today) memory.delete(key);
  }
}
