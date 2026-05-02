import { cookies } from 'next/headers';
import { normalizeSpaceName } from './spaces';
import {
  DEFAULT_CHANNEL_SPACE,
  type ChannelPreference,
  type ChannelPreferenceStore,
  type SavedVideo,
  type ViewPreferences,
} from './types';
import { DEFAULT_VIEW_PREFERENCES, normalizeViewPreferences } from './view-preferences';

const COOKIE = 'tubeo_channels';
const COOKIE_CHUNK_COUNT = `${COOKIE}_chunks`;
const COOKIE_CHUNK_PREFIX = `${COOKIE}_chunk_`;
const DRIVE_READY_COOKIE = 'tubeo_drive_ready';
const LOCAL_UPDATED_COOKIE = 'tubeo_channels_updated_at';
const LOCAL_DIRTY_COOKIE = 'tubeo_channels_dirty';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const EPOCH = new Date(0).toISOString();
const COOKIE_CHUNK_SIZE = 3000;
const COOKIE_OPTIONS = {
  maxAge: MAX_AGE,
  path: '/',
  sameSite: 'lax' as const,
};

function dedupeSpaces(spaces: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const space of spaces) {
    const normalized = normalizeSpaceName(space);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function dedupePreferences(channels: ChannelPreference[]): ChannelPreference[] {
  const seen = new Set<string>();
  const out: ChannelPreference[] = [];

  for (const channel of channels) {
    if (!channel.id || seen.has(channel.id)) continue;
    seen.add(channel.id);
    out.push({ id: channel.id, space: normalizeSpaceName(channel.space) });
  }

  return out;
}

function normalizeUpdatesChannelIds(value: string[] | undefined, channelIds: string[]): string[] {
  const valid = new Set(channelIds);
  return [...new Set((value ?? []).map((id) => id.trim()).filter((id) => valid.has(id)))];
}

function normalizeSavedVideos(value: SavedVideo[] | undefined): SavedVideo[] {
  const seen = new Set<string>();
  const out: SavedVideo[] = [];

  for (const item of value ?? []) {
    const id = item?.id?.trim();
    const url = item?.url?.trim();
    if (!id || !url || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      url,
      note: item.note?.trim() ?? '',
      addedAt: item.addedAt || new Date().toISOString(),
    });
  }

  return out;
}

function normalizeStore(store: ChannelPreferenceStore): ChannelPreferenceStore {
  const channels = dedupePreferences(store.channels);
  const spaces = dedupeSpaces([
    DEFAULT_CHANNEL_SPACE,
    ...store.spaces,
    ...channels.map((channel) => channel.space),
  ]);
  const view = normalizeViewPreferences(store.view);
  const viewUpdatedAt = store.viewUpdatedAt || EPOCH;
  const updatesChannelIds = normalizeUpdatesChannelIds(store.updatesChannelIds, channels.map((channel) => channel.id));
  const savedVideos = normalizeSavedVideos(store.savedVideos);

  return { channels, spaces, view, viewUpdatedAt, updatesChannelIds, savedVideos };
}

function parseCookieChannelStore(raw: string): ChannelPreferenceStore {
  const value = raw.trim();
  if (!value) {
    return {
      channels: [],
      spaces: [DEFAULT_CHANNEL_SPACE],
      view: DEFAULT_VIEW_PREFERENCES,
      viewUpdatedAt: EPOCH,
      updatesChannelIds: [],
      savedVideos: [],
    };
  }

  if (!value.startsWith('{') && !value.startsWith('[')) {
    return normalizeStore({
      channels: value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => ({ id, space: DEFAULT_CHANNEL_SPACE })),
      spaces: [DEFAULT_CHANNEL_SPACE],
      view: DEFAULT_VIEW_PREFERENCES,
      viewUpdatedAt: EPOCH,
      updatesChannelIds: [],
      savedVideos: [],
    });
  }

  try {
    const parsed = JSON.parse(value) as
      | {
          channels?: Array<{ id?: string; space?: string }>;
          spaces?: string[];
          view?: Partial<ViewPreferences>;
          viewUpdatedAt?: string;
          updatesChannelIds?: string[];
          savedVideos?: SavedVideo[];
        }
      | Array<{ id?: string; space?: string }>
      | null;

    const channels = Array.isArray(parsed) ? parsed : parsed?.channels ?? [];
    const spaces = Array.isArray(parsed) ? [] : parsed?.spaces ?? [];
    const view = Array.isArray(parsed) ? DEFAULT_VIEW_PREFERENCES : parsed?.view;
    const viewUpdatedAt = Array.isArray(parsed) ? EPOCH : parsed?.viewUpdatedAt ?? EPOCH;

    return normalizeStore({
      channels: channels
        .map((item) => ({
          id: item?.id?.trim() ?? '',
          space: normalizeSpaceName(item?.space),
        }))
        .filter((item) => item.id),
      spaces,
      view: normalizeViewPreferences(view),
      viewUpdatedAt,
      updatesChannelIds: Array.isArray(parsed) ? [] : parsed?.updatesChannelIds ?? [],
      savedVideos: Array.isArray(parsed) ? [] : parsed?.savedVideos ?? [],
    });
  } catch {
    return {
      channels: [],
      spaces: [DEFAULT_CHANNEL_SPACE],
      view: DEFAULT_VIEW_PREFERENCES,
      viewUpdatedAt: EPOCH,
      updatesChannelIds: [],
      savedVideos: [],
    };
  }
}

function readChunkedCookieStore(jar: Awaited<ReturnType<typeof cookies>>): string {
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

function clearCookieStoreChunks(jar: Awaited<ReturnType<typeof cookies>>): void {
  jar.delete(COOKIE);
  jar.delete(COOKIE_CHUNK_COUNT);

  for (const cookie of jar.getAll()) {
    if (cookie.name.startsWith(COOKIE_CHUNK_PREFIX)) {
      jar.delete(cookie.name);
    }
  }
}

export async function getCookieChannelStore(): Promise<ChannelPreferenceStore> {
  const jar = await cookies();
  const raw = readChunkedCookieStore(jar);
  return parseCookieChannelStore(raw);
}

export async function getCookieChannelPreferences(): Promise<ChannelPreference[]> {
  return (await getCookieChannelStore()).channels;
}

export async function getCookieChannelSpaces(): Promise<string[]> {
  return (await getCookieChannelStore()).spaces;
}

export async function getCookieChannelIds(): Promise<string[]> {
  return (await getCookieChannelPreferences()).map((channel) => channel.id);
}

export async function getCookieViewPreferences(): Promise<ViewPreferences> {
  return (await getCookieChannelStore()).view;
}

export async function setCookieChannelIds(ids: string[]): Promise<void> {
  await setCookieChannelPreferences(ids.map((id) => ({ id, space: DEFAULT_CHANNEL_SPACE })));
}

export async function setCookieChannelStore(store: ChannelPreferenceStore): Promise<void> {
  const jar = await cookies();
  const value = JSON.stringify(normalizeStore(store));
  const chunks = value.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, 'g')) ?? [''];

  clearCookieStoreChunks(jar);
  jar.set(COOKIE_CHUNK_COUNT, String(chunks.length), COOKIE_OPTIONS);
  chunks.forEach((chunk, index) => {
    jar.set(`${COOKIE_CHUNK_PREFIX}${index}`, chunk, COOKIE_OPTIONS);
  });
}

export async function hasDriveSyncHydrated(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(DRIVE_READY_COOKIE)?.value === '1';
}

export async function markDriveSyncHydrated(): Promise<void> {
  const jar = await cookies();
  jar.set(DRIVE_READY_COOKIE, '1', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function getCookieChannelSyncMeta(): Promise<{ updatedAt: string | null; dirty: boolean }> {
  const jar = await cookies();
  return {
    updatedAt: jar.get(LOCAL_UPDATED_COOKIE)?.value ?? null,
    dirty: jar.get(LOCAL_DIRTY_COOKIE)?.value === '1',
  };
}

export async function markCookieChannelStoreDirty(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
  jar.set(LOCAL_DIRTY_COOKIE, '1', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function markCookieChannelStoreSynced(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
  jar.set(LOCAL_DIRTY_COOKIE, '0', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function setCookieChannelPreferences(channels: ChannelPreference[]): Promise<void> {
  const existing = await getCookieChannelStore();
  await setCookieChannelStore({
    channels,
    spaces: existing.spaces,
    view: existing.view,
    viewUpdatedAt: existing.viewUpdatedAt,
    updatesChannelIds: existing.updatesChannelIds,
    savedVideos: existing.savedVideos,
  });
}

export async function setCookieChannelSpaces(spaces: string[]): Promise<void> {
  const existing = await getCookieChannelStore();
  await setCookieChannelStore({
    channels: existing.channels,
    spaces,
    view: existing.view,
    viewUpdatedAt: existing.viewUpdatedAt,
    updatesChannelIds: existing.updatesChannelIds,
    savedVideos: existing.savedVideos,
  });
}

export async function setCookieViewPreferences(view: ViewPreferences, viewUpdatedAt = new Date().toISOString()): Promise<void> {
  const existing = await getCookieChannelStore();
  await setCookieChannelStore({
    channels: existing.channels,
    spaces: existing.spaces,
    view,
    viewUpdatedAt,
    updatesChannelIds: existing.updatesChannelIds,
    savedVideos: existing.savedVideos,
  });
}

export async function clearCookieChannelIds(): Promise<void> {
  const jar = await cookies();
  clearCookieStoreChunks(jar);
  jar.delete(DRIVE_READY_COOKIE);
  jar.delete(LOCAL_UPDATED_COOKIE);
  jar.delete(LOCAL_DIRTY_COOKIE);
}
