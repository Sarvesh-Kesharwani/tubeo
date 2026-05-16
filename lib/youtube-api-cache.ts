import 'server-only';

import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 2_000;

interface CacheEntry<T = unknown> {
  key: string;
  path: string;
  params: Record<string, string>;
  data: T;
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

async function writeEntry<T>(apiPath: string, params: Record<string, string>, key: string, data: T): Promise<void> {
  const now = new Date().toISOString();
  const previous = memory.get(key);
  memory.set(key, {
    key,
    path: apiPath,
    params: normalizeParams(params),
    data,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    lastAccessedAt: now,
  });
  prune();
  await save();
}

async function fetchFresh<T>(
  apiPath: string,
  params: Record<string, string>,
  key: string,
  revalidate: number,
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
  await writeEntry(apiPath, params, key, data);
  return { data, fromCache: false };
}

export async function getCachedYouTubeJson<T>(
  apiPath: string,
  params: Record<string, string>,
  revalidate = 600,
): Promise<YouTubeApiResult<T>> {
  await ensureLoaded();

  const key = cacheKey(apiPath, params);
  const cached = memory.get(key) as CacheEntry<T> | undefined;
  if (cached) {
    cached.lastAccessedAt = new Date().toISOString();
    void save();
    return { data: cached.data, fromCache: true };
  }

  const existing = inflight.get(key);
  if (existing) return existing as Promise<YouTubeApiResult<T>>;

  const request = fetchFresh<T>(apiPath, params, key, revalidate).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request as Promise<YouTubeApiResult<unknown>>);
  return request;
}
