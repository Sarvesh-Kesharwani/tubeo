// Self-contained watch-later store: own cookie, own Drive file, no entanglement
// with the channels/view sync paths that previously kept clobbering it.

import { cookies } from 'next/headers';
import type { Session } from 'next-auth';
import {
  getTubeoUserIdentity,
} from './supabase-sync';
import {
  isSupabaseSavedVideosConfigured,
  readSupabaseSavedVideos,
  writeSupabaseSavedVideos,
} from './supabase-saved-videos';
export {
  INSTAGRAM_SAVED_PREFIX,
  UNCATEGORIZED_SAVED_CATEGORY,
  WEBPAGE_SAVED_PREFIX,
  getSavedVideoKind,
  normalizeSavedVideoCategory,
  type SavedVideo,
  type SavedVideoKind,
} from './saved-videos-shared';
import {
  INSTAGRAM_SAVED_PREFIX,
  UNCATEGORIZED_SAVED_CATEGORY,
  WEBPAGE_SAVED_PREFIX,
  normalizeSavedVideoCategory,
  type SavedVideo,
} from './saved-videos-shared';

// --- Cookie storage -------------------------------------------------------

const COOKIE = 'tubeo_saved_videos';
const COOKIE_CHUNK_COUNT = `${COOKIE}_chunks`;
const COOKIE_CHUNK_PREFIX = `${COOKIE}_chunk_`;
const UPDATED_COOKIE = `${COOKIE}_updated_at`;
const DIRTY_COOKIE = `${COOKIE}_dirty`;
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const COOKIE_CHUNK_SIZE = 3000;
const COOKIE_OPTIONS = {
  maxAge: MAX_AGE,
  path: '/',
  sameSite: 'lax' as const,
};

type Jar = Awaited<ReturnType<typeof cookies>>;

function readChunked(jar: Jar): string {
  const count = Number(jar.get(COOKIE_CHUNK_COUNT)?.value ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    return jar.get(COOKIE)?.value ?? '';
  }
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = jar.get(`${COOKIE_CHUNK_PREFIX}${i}`)?.value;
    if (typeof chunk !== 'string') return jar.get(COOKIE)?.value ?? '';
    chunks.push(chunk);
  }
  return chunks.join('');
}

function clearChunks(jar: Jar): void {
  jar.delete(COOKIE);
  jar.delete(COOKIE_CHUNK_COUNT);
  for (const cookie of jar.getAll()) {
    if (cookie.name.startsWith(COOKIE_CHUNK_PREFIX)) {
      jar.delete(cookie.name);
    }
  }
}

function normalize(videos: SavedVideo[]): SavedVideo[] {
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

export function isUncategorizedSavedVideo(video: SavedVideo): boolean {
  return normalizeSavedVideoCategory(video.category) === UNCATEGORIZED_SAVED_CATEGORY;
}

export async function getCookieSavedVideos(): Promise<SavedVideo[]> {
  const jar = await cookies();
  const raw = readChunked(jar);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { videos?: SavedVideo[] } | SavedVideo[] | null;
    const list = Array.isArray(parsed) ? parsed : parsed?.videos ?? [];
    return normalize(list);
  } catch {
    return [];
  }
}

export async function setCookieSavedVideos(videos: SavedVideo[]): Promise<void> {
  const jar = await cookies();
  const value = JSON.stringify({ videos: normalize(videos) });
  const chunks = value.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, 'g')) ?? [''];

  clearChunks(jar);
  jar.set(COOKIE_CHUNK_COUNT, String(chunks.length), COOKIE_OPTIONS);
  chunks.forEach((chunk, index) => {
    jar.set(`${COOKIE_CHUNK_PREFIX}${index}`, chunk, COOKIE_OPTIONS);
  });
}

export async function getCookieSavedVideosMeta(): Promise<{ updatedAt: string | null; dirty: boolean }> {
  const jar = await cookies();
  return {
    updatedAt: jar.get(UPDATED_COOKIE)?.value ?? null,
    dirty: jar.get(DIRTY_COOKIE)?.value === '1',
  };
}

export async function markSavedVideosDirty(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(UPDATED_COOKIE, updatedAt, COOKIE_OPTIONS);
  jar.set(DIRTY_COOKIE, '1', COOKIE_OPTIONS);
}

export async function markSavedVideosSynced(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(UPDATED_COOKIE, updatedAt, COOKIE_OPTIONS);
  jar.set(DIRTY_COOKIE, '0', COOKIE_OPTIONS);
}

export async function clearCookieSavedVideos(): Promise<void> {
  const jar = await cookies();
  clearChunks(jar);
  jar.delete(UPDATED_COOKIE);
  jar.delete(DIRTY_COOKIE);
}

// --- Drive storage --------------------------------------------------------

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_FILE_NAME = 'tubeo-saved-videos.json';
const DRIVE_SPACE = 'appDataFolder';

interface DrivePayload {
  videos: SavedVideo[];
  updatedAt: string;
}

type SavedVideosSession = Pick<Session, 'accessToken' | 'user'> | null | undefined;

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findDriveFileId(accessToken: string): Promise<string | null> {
  const query = `name='${escapeDriveQueryValue(DRIVE_FILE_NAME)}' and '${escapeDriveQueryValue(DRIVE_SPACE)}' in parents`;
  const qs = new URLSearchParams({ spaces: DRIVE_SPACE, fields: 'files(id)', q: query });
  const res = await fetch(`${DRIVE_API}/files?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: Array<{ id?: string }> };
  return data.files?.[0]?.id ?? null;
}

async function readDriveFile(accessToken: string, fileId: string): Promise<DrivePayload | null> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as Partial<DrivePayload>;
    return {
      videos: normalize(data.videos ?? []),
      updatedAt: data.updatedAt || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function uploadDriveFile(
  accessToken: string,
  body: string,
  fileId: string | null,
): Promise<void> {
  if (fileId) {
    const res = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Saved-videos PATCH failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    return;
  }

  const metadata = JSON.stringify({ name: DRIVE_FILE_NAME, parents: [DRIVE_SPACE] });
  const boundary = 'tubeo_sv_boundary';
  const multipart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    body,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Saved-videos POST failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

export async function readDriveSavedVideos(accessToken: string): Promise<DrivePayload | null> {
  const fileId = await findDriveFileId(accessToken);
  if (!fileId) return null;
  return readDriveFile(accessToken, fileId);
}

export async function writeDriveSavedVideos(
  accessToken: string,
  videos: SavedVideo[],
): Promise<{ updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const body = JSON.stringify({ videos: normalize(videos), updatedAt });
  const fileId = await findDriveFileId(accessToken);
  await uploadDriveFile(accessToken, body, fileId);
  return { updatedAt };
}

// --- URL parsing ----------------------------------------------------------

const YOUTUBE_ID_RE = /^[\w-]{11}$/;

export function parseYouTubeVideoId(raw: string): string | null {
  const value = raw.trim();
  if (YOUTUBE_ID_RE.test(value)) return value;

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (!url.hostname.includes('youtu')) return null;

    if (url.hostname.includes('youtu.be')) {
      const candidate = url.pathname.split('/').filter(Boolean)[0];
      return candidate && YOUTUBE_ID_RE.test(candidate) ? candidate : null;
    }

    const v = url.searchParams.get('v');
    if (v && YOUTUBE_ID_RE.test(v)) return v;

    const segs = url.pathname.split('/').filter(Boolean);
    const keyed = ['shorts', 'embed', 'live', 'v'];
    const idx = segs.findIndex((s) => keyed.includes(s));
    if (idx !== -1) {
      const candidate = segs[idx + 1];
      if (candidate && YOUTUBE_ID_RE.test(candidate)) return candidate;
    }

    return null;
  } catch {
    return null;
  }
}

export function parseInstagramReelId(raw: string): string | null {
  const value = raw.trim();
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (!url.hostname.includes('instagram.com')) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const idx = segments.findIndex((s) => s === 'reel' || s === 'reels' || s === 'p' || s === 'tv');
    if (idx === -1) return null;
    const id = segments[idx + 1];
    return id && /^[\w-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function parseWebpageUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36) + s.length.toString(36);
}

export function resolveSavedVideoFromUrl(rawUrl: string): { id: string; url: string } | null {
  const ytId = parseYouTubeVideoId(rawUrl);
  if (ytId) return { id: ytId, url: `https://www.youtube.com/watch?v=${ytId}` };

  const igId = parseInstagramReelId(rawUrl);
  if (igId) return { id: `${INSTAGRAM_SAVED_PREFIX}${igId}`, url: `https://www.instagram.com/reel/${igId}/` };

  const webpage = parseWebpageUrl(rawUrl);
  if (webpage) return { id: `${WEBPAGE_SAVED_PREFIX}${hashString(webpage)}`, url: webpage };

  return null;
}

// --- Public ops -----------------------------------------------------------

function mergeByIdPreservingOrder(local: SavedVideo[], remote: SavedVideo[]): SavedVideo[] {
  // Local first (new local-only adds appear at top), then remote-only items
  // (which represent things added on another device).
  const seen = new Set<string>();
  const out: SavedVideo[] = [];
  for (const item of local) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  for (const item of remote) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

async function readRemoteSavedVideos(
  session: SavedVideosSession,
): Promise<{ videos: SavedVideo[]; updatedAt: string; source: 'supabase' | 'drive' } | null> {
  const identity = getTubeoUserIdentity(session as Session | null | undefined);
  if (identity && isSupabaseSavedVideosConfigured()) {
    try {
      const supabase = await readSupabaseSavedVideos(identity);
      if (supabase) return { ...supabase, source: 'supabase' };
    } catch {
      // Keep Drive as backup if DB is temporarily unavailable or not migrated yet.
    }

    if (session?.accessToken) {
      const drive = await readDriveSavedVideos(session.accessToken);
      if (drive) {
        await writeSupabaseSavedVideos(identity, drive.videos).catch(() => null);
        return { ...drive, source: 'drive' };
      }
    }

    return null;
  }

  if (!session?.accessToken) return null;
  const drive = await readDriveSavedVideos(session.accessToken);
  return drive ? { ...drive, source: 'drive' } : null;
}

async function writeRemoteSavedVideos(
  session: SavedVideosSession,
  videos: SavedVideo[],
): Promise<{ synced: boolean; updatedAt: string; driveBackupOk: boolean }> {
  const identity = getTubeoUserIdentity(session as Session | null | undefined);
  if (identity && isSupabaseSavedVideosConfigured()) {
    const supabase = await writeSupabaseSavedVideos(identity, videos).catch(() => null);
    let driveBackupOk = false;
    if (session?.accessToken) {
      try {
        await writeDriveSavedVideos(session.accessToken, videos);
        driveBackupOk = true;
      } catch {
        driveBackupOk = false;
      }
    }
    if (supabase) return { synced: true, updatedAt: supabase.updatedAt, driveBackupOk };
    return { synced: false, updatedAt: new Date().toISOString(), driveBackupOk };
  }

  if (!session?.accessToken) {
    return { synced: false, updatedAt: new Date().toISOString(), driveBackupOk: false };
  }

  const { updatedAt } = await writeDriveSavedVideos(session.accessToken, videos);
  return { synced: true, updatedAt, driveBackupOk: true };
}

// Hydrate cookie from Supabase/Drive if the cookie is empty + not dirty + remote has data.
// Never overwrites a non-empty/dirty cookie.
export async function hydrateSavedVideosFromDriveIfNeeded(
  session: SavedVideosSession,
): Promise<void> {
  const [cookieVideos, meta] = await Promise.all([
    getCookieSavedVideos(),
    getCookieSavedVideosMeta(),
  ]);
  if (meta.dirty || cookieVideos.length > 0) return;

  try {
    const remote = await readRemoteSavedVideos(session);
    if (!remote) return;
    await setCookieSavedVideos(remote.videos);
    await markSavedVideosSynced(remote.updatedAt);
  } catch {
    // Swallow. Remote storage will be retried on the next mutation/sync.
  }
}

export async function persistSavedVideos(
  videos: SavedVideo[],
  session: SavedVideosSession,
): Promise<{ synced: boolean; updatedAt: string }> {
  await setCookieSavedVideos(videos);

  try {
    const { synced, updatedAt } = await writeRemoteSavedVideos(session, videos);
    if (!synced) {
      await markSavedVideosDirty(updatedAt);
      return { synced: false, updatedAt };
    }
    await markSavedVideosSynced(updatedAt);
    return { synced: true, updatedAt };
  } catch {
    const updatedAt = new Date().toISOString();
    await markSavedVideosDirty(updatedAt);
    return { synced: false, updatedAt };
  }
}

// Manual sync (called from the SyncButton path). Merges local + remote and writes back.
export async function reconcileSavedVideos(session: SavedVideosSession): Promise<{
  videos: SavedVideo[];
  synced: boolean;
  updatedAt: string;
}> {
  const [localVideos, remote] = await Promise.all([
    getCookieSavedVideos(),
    readRemoteSavedVideos(session).catch(() => null),
  ]);

  const remoteVideos = remote?.videos ?? [];
  const merged = mergeByIdPreservingOrder(localVideos, remoteVideos);

  await setCookieSavedVideos(merged);

  try {
    const { synced, updatedAt } = await writeRemoteSavedVideos(session, merged);
    if (!synced) {
      await markSavedVideosDirty(updatedAt);
      return { videos: merged, synced: false, updatedAt };
    }
    await markSavedVideosSynced(updatedAt);
    return { videos: merged, synced: true, updatedAt };
  } catch {
    const updatedAt = new Date().toISOString();
    await markSavedVideosDirty(updatedAt);
    return { videos: merged, synced: false, updatedAt };
  }
}
