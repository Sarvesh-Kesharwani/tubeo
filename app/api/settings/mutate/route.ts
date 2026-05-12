import { revalidatePath } from 'next/cache';
import {
  getCookieChannelIds,
  getCookieChannelSyncMeta,
  getCookieChannelStore,
  getCookieChannelPreferences,
  hasDriveSyncHydrated,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  markDriveSyncHydrated,
  setCookieChannelStore,
  setCookieChannelSpaces,
  setCookieChannelPreferences,
} from '@/lib/channels-cookie';
import { readDriveChannels, writeDriveChannels } from '@/lib/drive';
import { getSession } from '@/lib/session';
import { normalizeSpaceName } from '@/lib/spaces';
import { DEFAULT_CHANNEL_SPACE, type ChannelPreference, type ChannelPreferenceStore, type SavedVideo } from '@/lib/types';
import { getEnvChannelIds } from '@/lib/whitelist';

const API = 'https://www.googleapis.com/youtube/v3';

function apiKey(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY missing');
  return k;
}

async function hydrateCookieStoreFromDriveIfNeeded(): Promise<void> {
  const session = await getSession();
  if (!session?.accessToken) return;
  if (await hasDriveSyncHydrated()) return;

  const driveData = await readDriveChannels(session.accessToken);
  const localMeta = await getCookieChannelSyncMeta();
  if (driveData) {
    const envIds = getEnvChannelIds();
    await setCookieChannelStore({
      channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
      spaces: driveData.spaces,
      view: driveData.view,
      viewUpdatedAt: driveData.viewUpdatedAt,
      updatesChannelIds: driveData.updatesChannelIds,
      savedVideos: driveData.savedVideos,
    });
    await markCookieChannelStoreSynced(driveData.updatedAt);
  } else if (localMeta.updatedAt) {
    await markCookieChannelStoreSynced(localMeta.updatedAt);
  }

  await markDriveSyncHydrated();
}

function parseInput(raw: string): { type: 'id'; value: string } | { type: 'handle'; value: string } | null {
  const s = raw.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { type: 'id', value: s };

  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && parts[1]?.startsWith('UC')) return { type: 'id', value: parts[1] };
    const handle = parts[0]?.startsWith('@') ? parts[0] : parts[1]?.startsWith('@') ? parts[1] : parts[0];
    if (handle) return { type: 'handle', value: handle.replace(/^@/, '') };
  } catch {
    if (s) return { type: 'handle', value: s.replace(/^@/, '') };
  }
  return null;
}

async function resolveToChannelId(raw: string): Promise<string> {
  const parsed = parseInput(raw);
  if (!parsed) throw new Error('Could not parse channel URL or handle');

  if (parsed.type === 'id') return parsed.value;

  const qs = new URLSearchParams({
    part: 'snippet',
    type: 'channel',
    q: parsed.value,
    maxResults: '1',
    key: apiKey(),
  });
  const res = await fetch(`${API}/search?${qs}`);
  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
  const data = await res.json();
  const id = data.items?.[0]?.snippet?.channelId;
  if (!id) throw new Error(`Channel not found for "${parsed.value}"`);
  return id;
}

function ok(data: Record<string, unknown>) {
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
  return Response.json({ ok: true, ...data });
}

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function mergeSavedVideos(local: SavedVideo[], drive: SavedVideo[] = []): SavedVideo[] {
  const seen = new Set<string>();
  const merged: SavedVideo[] = [];

  for (const video of [...local, ...drive]) {
    if (!video.id || seen.has(video.id)) continue;
    seen.add(video.id);
    merged.push(video);
  }

  return merged;
}

async function persistSavedVideoStore(
  store: ChannelPreferenceStore,
  options: { mergeDriveSavedVideos?: boolean } = {},
): Promise<boolean> {
  const session = await getSession();
  const canWriteDrive = Boolean(session?.accessToken) && await hasDriveSyncHydrated();
  let nextStore = store;

  if (!canWriteDrive || !session?.accessToken) {
    await setCookieChannelStore(nextStore);
    await markCookieChannelStoreDirty();
    return false;
  }

  try {
    const driveData = await readDriveChannels(session.accessToken);
    if (options.mergeDriveSavedVideos) {
      nextStore = {
        ...nextStore,
        savedVideos: mergeSavedVideos(nextStore.savedVideos, driveData?.savedVideos),
      };
    }

    await setCookieChannelStore(nextStore);
    const envIds = getEnvChannelIds();
    const syncedAt = new Date().toISOString();
    await writeDriveChannels(session.accessToken, {
      channels: nextStore.channels.filter((channel) => !envIds.includes(channel.id)),
      spaces: nextStore.spaces,
      view: nextStore.view,
      viewUpdatedAt: nextStore.viewUpdatedAt,
      updatesChannelIds: nextStore.updatesChannelIds,
      savedVideos: nextStore.savedVideos,
      quota: driveData?.quota,
    });
    await markCookieChannelStoreSynced(syncedAt);
    return true;
  } catch {
    await setCookieChannelStore(nextStore);
    await markCookieChannelStoreDirty();
    return false;
  }
}

const YOUTUBE_ID_RE = /^[\w-]{11}$/;

function parseVideoId(raw: string): string | null {
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

function parseWebpageUrl(raw: string): string | null {
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

function parseInstagramReelId(raw: string): string | null {
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

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('Invalid request body');
  }

  const type = String(body.type ?? '');

  try {
    await hydrateCookieStoreFromDriveIfNeeded();

    if (type === 'addChannel') {
      const input = String(body.url ?? '').trim();
      if (!input) return fail('Please enter a channel URL or handle.');

      const channelId = await resolveToChannelId(input);
      const existing = await getCookieChannelIds();
      if (existing.includes(channelId)) return fail('Channel already added.');

      const channels = await getCookieChannelPreferences();
      await setCookieChannelPreferences([...channels, { id: channelId, space: DEFAULT_CHANNEL_SPACE }]);
      await markCookieChannelStoreDirty();
      return ok({ success: channelId });
    }

    if (type === 'createSpace') {
      const nextSpace = normalizeSpaceName(String(body.space ?? ''));
      const store = await getCookieChannelStore();
      if (store.spaces.includes(nextSpace)) return fail('That space already exists.');

      await setCookieChannelSpaces([...store.spaces, nextSpace]);
      await markCookieChannelStoreDirty();
      return ok({ success: nextSpace });
    }

    if (type === 'removeChannel') {
      const channelId = String(body.channelId ?? '').trim();
      const existing = await getCookieChannelPreferences();
      await setCookieChannelPreferences(existing.filter((channel) => channel.id !== channelId));
      await markCookieChannelStoreDirty();
      return ok({ success: channelId });
    }

    if (type === 'moveChannel') {
      const channelId = String(body.channelId ?? '').trim();
      const nextSpace = normalizeSpaceName(String(body.nextSpace ?? ''));
      const store = await getCookieChannelStore();
      const existing = store.channels;
      const index = existing.findIndex((channel) => channel.id === channelId);

      if (index === -1) {
        await setCookieChannelPreferences([...existing, { id: channelId, space: nextSpace }]);
      } else {
        const updated = [...existing];
        updated[index] = { ...updated[index], space: nextSpace };
        await setCookieChannelPreferences(updated);
      }

      await setCookieChannelSpaces([...store.spaces, nextSpace]);
      await markCookieChannelStoreDirty();
      return ok({ success: nextSpace });
    }

    if (type === 'renameSpace') {
      const existingSpace = normalizeSpaceName(String(body.currentSpace ?? ''));
      const renamedSpace = normalizeSpaceName(String(body.nextSpace ?? ''));
      const store = await getCookieChannelStore();

      if (existingSpace === DEFAULT_CHANNEL_SPACE) {
        return fail(`${DEFAULT_CHANNEL_SPACE} is the default space and cannot be renamed.`);
      }
      if (!store.spaces.includes(existingSpace)) return fail('That space no longer exists.');
      if (existingSpace !== renamedSpace && store.spaces.includes(renamedSpace)) {
        return fail('That space already exists.');
      }

      await setCookieChannelStore({
        channels: store.channels.map((channel) =>
          channel.space === existingSpace ? { ...channel, space: renamedSpace } : channel,
        ),
        spaces: store.spaces.map((space) => (space === existingSpace ? renamedSpace : space)),
        view: store.view,
        viewUpdatedAt: store.viewUpdatedAt,
        updatesChannelIds: store.updatesChannelIds,
        savedVideos: store.savedVideos,
      });
      await markCookieChannelStoreDirty();
      return ok({ success: renamedSpace });
    }

    if (type === 'deleteSpace') {
      const targetSpace = normalizeSpaceName(String(body.space ?? ''));
      const store = await getCookieChannelStore();

      if (targetSpace === DEFAULT_CHANNEL_SPACE) {
        return fail(`${DEFAULT_CHANNEL_SPACE} is the default space and cannot be deleted.`);
      }
      if (!store.spaces.includes(targetSpace)) return fail('That space no longer exists.');

      await setCookieChannelStore({
        channels: store.channels.map((channel) =>
          channel.space === targetSpace ? { ...channel, space: DEFAULT_CHANNEL_SPACE } : channel,
        ),
        spaces: store.spaces.filter((space) => space !== targetSpace),
        view: store.view,
        viewUpdatedAt: store.viewUpdatedAt,
        updatesChannelIds: store.updatesChannelIds,
        savedVideos: store.savedVideos,
      });
      await markCookieChannelStoreDirty();
      return ok({ success: targetSpace });
    }

    if (type === 'reorderSpace') {
      const space = normalizeSpaceName(String(body.space ?? ''));
      const direction = String(body.direction ?? '');
      const store = await getCookieChannelStore();
      const spaces = [...store.spaces];
      const index = spaces.indexOf(space);
      if (index === -1) return fail('That space no longer exists.');

      const nextIndex = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : index;
      if (nextIndex < 0 || nextIndex >= spaces.length) return ok({ success: space });

      [spaces[index], spaces[nextIndex]] = [spaces[nextIndex], spaces[index]];
      await setCookieChannelStore({ ...store, spaces });
      await markCookieChannelStoreDirty();
      return ok({ success: space });
    }

    if (type === 'setSpaceOrder') {
      const incoming = Array.isArray(body.spaces) ? body.spaces.map((s) => normalizeSpaceName(String(s))) : [];
      const store = await getCookieChannelStore();
      const known = new Set(store.spaces);
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const space of incoming) {
        if (!known.has(space) || seen.has(space)) continue;
        seen.add(space);
        ordered.push(space);
      }
      for (const space of store.spaces) {
        if (seen.has(space)) continue;
        seen.add(space);
        ordered.push(space);
      }

      await setCookieChannelStore({ ...store, spaces: ordered });
      await markCookieChannelStoreDirty();
      return ok({ success: ordered.length });
    }

    if (type === 'setChannelOrderInSpace') {
      const space = normalizeSpaceName(String(body.space ?? ''));
      const incoming = Array.isArray(body.channelIds) ? body.channelIds.map((id) => String(id)) : [];
      const store = await getCookieChannelStore();

      const inSpaceIds = store.channels.filter((channel) => channel.space === space).map((channel) => channel.id);
      const inSpaceSet = new Set(inSpaceIds);
      const seen = new Set<string>();
      const orderedIds: string[] = [];
      for (const id of incoming) {
        if (!inSpaceSet.has(id) || seen.has(id)) continue;
        seen.add(id);
        orderedIds.push(id);
      }
      for (const id of inSpaceIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        orderedIds.push(id);
      }

      const prefMap = new Map(store.channels.map((channel) => [channel.id, channel]));
      let cursor = 0;
      const nextChannels: ChannelPreference[] = store.channels.map((channel) => {
        if (channel.space !== space) return channel;
        const nextId = orderedIds[cursor++];
        return prefMap.get(nextId) ?? channel;
      });

      await setCookieChannelStore({ ...store, channels: nextChannels });
      await markCookieChannelStoreDirty();
      return ok({ success: space });
    }

    if (type === 'setUpdatesChannels') {
      const channelIds = Array.isArray(body.channelIds) ? body.channelIds.map(String) : [];
      const store = await getCookieChannelStore();
      await setCookieChannelStore({ ...store, updatesChannelIds: channelIds });
      await markCookieChannelStoreDirty();
      revalidatePath('/updates');
      return ok({ success: channelIds.length });
    }

    if (type === 'addSavedVideo') {
      const url = String(body.url ?? '').trim();
      const note = String(body.note ?? '').trim();

      const ytId = parseVideoId(url);
      const igId = ytId ? null : parseInstagramReelId(url);
      const webpage = !ytId && !igId ? parseWebpageUrl(url) : null;
      if (!ytId && !igId && !webpage) return fail('Enter a valid URL.');

      const id = ytId
        ? ytId
        : igId
          ? `ig_${igId}`
          : `wp_${hashString(webpage!)}`;
      const canonicalUrl = ytId
        ? `https://www.youtube.com/watch?v=${ytId}`
        : igId
          ? `https://www.instagram.com/reel/${igId}/`
          : webpage!;

      const store = await getCookieChannelStore();
      const existing = store.savedVideos.filter((video) => video.id !== id);
      const savedVideo = { id, url: canonicalUrl, note, addedAt: new Date().toISOString() };
      const synced = await persistSavedVideoStore({
        ...store,
        savedVideos: [savedVideo, ...existing],
      }, { mergeDriveSavedVideos: true });
      revalidatePath('/videos');
      return ok({ success: id, synced, savedVideo });
    }

    if (type === 'updateSavedVideo') {
      const id = String(body.id ?? '').trim();
      const note = String(body.note ?? '').trim();
      const store = await getCookieChannelStore();
      const synced = await persistSavedVideoStore({
        ...store,
        savedVideos: store.savedVideos.map((video) => (video.id === id ? { ...video, note } : video)),
      });
      revalidatePath('/videos');
      return ok({ success: id, synced });
    }

    if (type === 'removeSavedVideo') {
      const id = String(body.id ?? '').trim();
      const store = await getCookieChannelStore();
      const synced = await persistSavedVideoStore({
        ...store,
        savedVideos: store.savedVideos.filter((video) => video.id !== id),
      });
      revalidatePath('/videos');
      return ok({ success: id, synced });
    }

    return fail('Unsupported action type');
  } catch (error) {
    return fail((error as Error).message || 'Request failed', 500);
  }
}
