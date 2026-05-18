import { revalidatePath } from 'next/cache';
import {
  getCookieChannelSyncMeta,
  getCookieChannelStore,
  hasDriveSyncHydrated,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  markDriveSyncHydrated,
  setCookieChannelStore,
} from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { normalizeSpaceName } from '@/lib/spaces';
import { readUserSyncState, writeUserSyncState } from '@/lib/sync-store';
import {
  DEFAULT_CHANNEL_SPACE,
  normalizeVocabWord,
  vocabIdFromWord,
  type ChannelPreference,
  type ChannelPreferenceStore,
  type DiscoveredChannel,
  type VocabItem,
} from '@/lib/types';
import { DeepSeekConfigError, DeepSeekRequestError, fetchVocabMeaning } from '@/lib/deepseek';
import { recordApiUsage } from '@/lib/api-usage';
import { getEnvChannelIds } from '@/lib/whitelist';
import {
  checkInstagramAccountAccess,
  instagramChannelId,
  parseInstagramChannelInput,
} from '@/lib/instagram';
import { clearMemoryYtCacheForDate, getCachedYouTubeJson } from '@/lib/youtube-api-cache';
import { istDateString } from '@/lib/news-source';
import { clearYtCacheForDate, isSupabaseYtCacheConfigured } from '@/lib/supabase-yt-cache';

async function hydrateCookieStoreFromDriveIfNeeded(): Promise<void> {
  const session = await getSession();
  if (!session?.user) return;
  if (await hasDriveSyncHydrated()) return;

  const remote = await readUserSyncState(session);
  const driveData = remote.state;
  const localMeta = await getCookieChannelSyncMeta();
  if (driveData) {
    const envIds = getEnvChannelIds();
    await setCookieChannelStore({
      channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
      spaces: driveData.spaces,
      view: driveData.view,
      viewUpdatedAt: driveData.viewUpdatedAt,
      updatesChannelIds: driveData.updatesChannelIds,
      vocabs: driveData.vocabs,
      ignoredChannels: driveData.ignoredChannels,
      discoverSearches: driveData.discoverSearches,
      activeDiscoverSearchId: driveData.activeDiscoverSearchId,
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

  const result = await getCachedYouTubeJson<{
    items?: Array<{ snippet?: { channelId?: string } }>;
  }>('search', {
    part: 'snippet',
    type: 'channel',
    q: parsed.value,
    maxResults: '1',
  });
  const data = result.data;
  const id = data.items?.[0]?.snippet?.channelId;
  if (!id) throw new Error(`Channel not found for "${parsed.value}"`);
  await recordApiUsage('youtube', `Add channel by handle: ${parsed.value}`, result.fromCache ? 0 : 100);
  return id;
}

async function ok(data: Record<string, unknown>, opts: { bustVideoCaches?: boolean } = {}) {
  if (opts.bustVideoCaches) {
    // Channel-set / space changes affect which channels & spaces the video pages render.
    // Drop today's persistent yt-cache rows + the in-process map so the next render fetches
    // fresh metadata and uploads playlists for the newly added/moved channel.
    const today = istDateString();
    if (isSupabaseYtCacheConfigured()) {
      try {
        await clearYtCacheForDate(today);
      } catch {
        // Best-effort. Memory cache + revalidatePath below still help.
      }
    }
    clearMemoryYtCacheForDate(today);
  }
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/news');
  revalidatePath('/updates');
  revalidatePath('/discover');
  revalidatePath('/settings');
  return Response.json({ ok: true, ...data });
}

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

async function persistChannelStore(store: ChannelPreferenceStore): Promise<boolean> {
  const session = await getSession();
  const canWriteRemote = Boolean(session?.user) && await hasDriveSyncHydrated();

  if (!canWriteRemote) {
    await setCookieChannelStore(store);
    await markCookieChannelStoreDirty();
    return false;
  }

  try {
    const remote = await readUserSyncState(session);
    const driveData = remote.state;
    await setCookieChannelStore(store);
    const envIds = getEnvChannelIds();
    const syncedAt = new Date().toISOString();
    await writeUserSyncState(session, {
      channels: store.channels.filter((channel) => !envIds.includes(channel.id)),
      spaces: store.spaces,
      view: store.view,
      viewUpdatedAt: store.viewUpdatedAt,
      updatesChannelIds: store.updatesChannelIds,
      vocabs: store.vocabs,
      ignoredChannels: store.ignoredChannels,
      discoverSearches: store.discoverSearches,
      activeDiscoverSearchId: store.activeDiscoverSearchId,
      discoverDraft: store.discoverDraft,
      lastPagePath: store.lastPagePath,
      quota: driveData?.quota,
    });
    await markCookieChannelStoreSynced(syncedAt);
    return true;
  } catch {
    await setCookieChannelStore(store);
    await markCookieChannelStoreDirty();
    return false;
  }
}

function normalizeDiscoveryChannel(value: unknown): DiscoveredChannel | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<DiscoveredChannel>;
  const id = item.id?.trim();
  if (!id) return null;

  return {
    id,
    title: item.title?.trim() || id,
    thumbnail: item.thumbnail || '',
    description: item.description || '',
    ignoredAt: item.ignoredAt || new Date().toISOString(),
    subscriberCount: typeof item.subscriberCount === 'number' ? item.subscriberCount : undefined,
    viewCount: typeof item.viewCount === 'number' ? item.viewCount : undefined,
    videoCount: typeof item.videoCount === 'number' ? item.videoCount : undefined,
    country: item.country || undefined,
  };
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

      const instagramUsername = parseInstagramChannelInput(input);
      if (instagramUsername) {
        const channelId = instagramChannelId(instagramUsername);
        const store = await getCookieChannelStore();
        if (store.channels.some((channel) => channel.id === channelId)) return fail('Instagram channel already added.');

        const access = await checkInstagramAccountAccess(instagramUsername);
        if (access.kind === 'personal') {
          return fail(
            `@${instagramUsername} isn't a Business or Creator account on Instagram, so its reels can't be loaded automatically. Forward reels from this account to @toolshub2026 to save them individually.`,
          );
        }
        if (access.kind === 'not_found') {
          return fail(`No Instagram account found for @${instagramUsername}.`);
        }
        if (access.kind === 'token_invalid') {
          return fail('Instagram access token is invalid or expired. Please update INSTAGRAM_ACCESS_TOKEN.');
        }
        if (access.kind === 'unknown_error') {
          return fail(`Instagram check failed: ${access.message}`);
        }

        const synced = await persistChannelStore({
          ...store,
          channels: [{ id: channelId, space: DEFAULT_CHANNEL_SPACE }, ...store.channels],
        });
        return ok({ success: `@${instagramUsername}`, synced }, { bustVideoCaches: true });
      }

      const channelId = await resolveToChannelId(input);
      const store = await getCookieChannelStore();
      if (store.channels.some((channel) => channel.id === channelId)) return fail('Channel already added.');

      const synced = await persistChannelStore({
        ...store,
        channels: [...store.channels, { id: channelId, space: DEFAULT_CHANNEL_SPACE }],
      });
      return ok({ success: channelId, synced }, { bustVideoCaches: true });
    }

    if (type === 'createSpace') {
      const nextSpace = normalizeSpaceName(String(body.space ?? ''));
      const store = await getCookieChannelStore();
      if (store.spaces.includes(nextSpace)) return fail('That space already exists.');

      const synced = await persistChannelStore({
        ...store,
        spaces: [...store.spaces, nextSpace],
      });
      return ok({ success: nextSpace, synced });
    }

    if (type === 'removeChannel') {
      const channelId = String(body.channelId ?? '').trim();
      const store = await getCookieChannelStore();
      const synced = await persistChannelStore({
        ...store,
        channels: store.channels.filter((channel) => channel.id !== channelId),
        updatesChannelIds: store.updatesChannelIds.filter((id) => id !== channelId),
      });
      return ok({ success: channelId, synced }, { bustVideoCaches: true });
    }

    if (type === 'moveChannel') {
      const channelId = String(body.channelId ?? '').trim();
      const nextSpace = normalizeSpaceName(String(body.nextSpace ?? ''));
      const store = await getCookieChannelStore();
      const existing = store.channels;
      const index = existing.findIndex((channel) => channel.id === channelId);

      const channels = [...existing];
      if (index === -1) {
        channels.push({ id: channelId, space: nextSpace });
      } else {
        channels[index] = { ...channels[index], space: nextSpace };
      }

      const synced = await persistChannelStore({
        ...store,
        channels,
        spaces: store.spaces.includes(nextSpace) ? store.spaces : [...store.spaces, nextSpace],
      });
      return ok({ success: nextSpace, synced }, { bustVideoCaches: true });
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
        vocabs: store.vocabs,
        ignoredChannels: store.ignoredChannels,
        discoverSearches: store.discoverSearches,
        activeDiscoverSearchId: store.activeDiscoverSearchId,
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
        vocabs: store.vocabs,
        ignoredChannels: store.ignoredChannels,
        discoverSearches: store.discoverSearches,
        activeDiscoverSearchId: store.activeDiscoverSearchId,
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

    if (type === 'acceptDiscoveredChannel') {
      const channel = normalizeDiscoveryChannel(body.channel);
      if (!channel) return fail('Channel payload missing.');

      const store = await getCookieChannelStore();
      const targetSpace = normalizeSpaceName('Uncategorized');
      const exists = store.channels.some((item) => item.id === channel.id);
      const synced = await persistChannelStore({
        ...store,
        channels: exists ? store.channels : [...store.channels, { id: channel.id, space: targetSpace }],
        spaces: store.spaces.includes(targetSpace) ? store.spaces : [...store.spaces, targetSpace],
        ignoredChannels: store.ignoredChannels.filter((item) => item.id !== channel.id),
      });
      return ok({ success: channel.id, synced }, { bustVideoCaches: true });
    }

    if (type === 'ignoreDiscoveredChannel') {
      const channel = normalizeDiscoveryChannel(body.channel);
      if (!channel) return fail('Channel payload missing.');

      const store = await getCookieChannelStore();
      const exists = store.ignoredChannels.some((item) => item.id === channel.id);
      const synced = await persistChannelStore({
        ...store,
        channels: store.channels.filter((item) => item.id !== channel.id),
        ignoredChannels: exists
          ? store.ignoredChannels.map((item) => (item.id === channel.id ? { ...channel, ignoredAt: item.ignoredAt } : item))
          : [{ ...channel, ignoredAt: new Date().toISOString() }, ...store.ignoredChannels],
      });
      return ok({ success: channel.id, synced }, { bustVideoCaches: true });
    }

    if (type === 'restoreIgnoredChannel') {
      const channelId = String(body.channelId ?? '').trim();
      if (!channelId) return fail('Channel ID missing.');

      const store = await getCookieChannelStore();
      const synced = await persistChannelStore({
        ...store,
        ignoredChannels: store.ignoredChannels.filter((item) => item.id !== channelId),
      });
      return ok({ success: channelId, synced });
    }

    if (type === 'deleteDiscoverSearch') {
      const searchId = String(body.searchId ?? '').trim();
      if (!searchId) return fail('Search ID missing.');

      const session = await getSession();
      const cookieStore = await getCookieChannelStore();
      const remote = session?.user
        ? await readUserSyncState(session).catch(() => ({ state: null }))
        : { state: null };
      const store = remote.state ?? cookieStore;

      const exists = store.discoverSearches.some((item) => item.id === searchId);
      if (!exists) return fail('Search no longer exists.');

      const nextSearches = store.discoverSearches.filter((item) => item.id !== searchId);
      const nextActiveId =
        store.activeDiscoverSearchId === searchId
          ? nextSearches[0]?.id
          : store.activeDiscoverSearchId;
      const synced = await persistChannelStore({
        ...store,
        discoverSearches: nextSearches,
        activeDiscoverSearchId: nextActiveId,
      });
      return ok({ success: searchId, synced });
    }

    if (type === 'addVocab') {
      const rawWord = String(body.word ?? '');
      const word = normalizeVocabWord(rawWord);
      if (!word) return fail('Enter a word.');

      const id = vocabIdFromWord(word);
      const store = await getCookieChannelStore();
      if (store.vocabs.some((vocab) => vocab.id === id)) {
        return fail('That word is already in your list.');
      }

      const now = new Date().toISOString();
      let meaning = '';
      let status: VocabItem['status'] = 'pending';
      let meaningError: string | null = null;
      try {
        meaning = await fetchVocabMeaning(word);
        status = 'ready';
      } catch (error) {
        status = 'failed';
        if (error instanceof DeepSeekConfigError) {
          meaningError = error.message;
        } else if (error instanceof DeepSeekRequestError) {
          meaningError = error.message;
        } else {
          meaningError = (error as Error)?.message ?? 'Failed to fetch meaning.';
        }
      }

      const vocab: VocabItem = {
        id,
        word,
        meaning,
        status,
        addedAt: now,
        meaningUpdatedAt: now,
      };
      const synced = await persistChannelStore({
        ...store,
        vocabs: [vocab, ...store.vocabs],
      });
      revalidatePath('/vocab');
      return ok({ success: id, synced, vocab, meaningError });
    }

    if (type === 'refetchVocabMeaning') {
      const id = String(body.id ?? '').trim();
      const store = await getCookieChannelStore();
      const target = store.vocabs.find((vocab) => vocab.id === id);
      if (!target) return fail('That word is no longer in your list.');

      const now = new Date().toISOString();
      let meaning = target.meaning;
      let status: VocabItem['status'] = target.status;
      let meaningError: string | null = null;
      try {
        meaning = await fetchVocabMeaning(target.word);
        status = 'ready';
      } catch (error) {
        status = 'failed';
        meaningError = (error as Error)?.message ?? 'Failed to fetch meaning.';
      }

      const vocab: VocabItem = {
        ...target,
        meaning,
        status,
        meaningUpdatedAt: now,
      };
      const synced = await persistChannelStore({
        ...store,
        vocabs: store.vocabs.map((item) => (item.id === id ? vocab : item)),
      });
      revalidatePath('/vocab');
      return ok({ success: id, synced, vocab, meaningError });
    }

    if (type === 'removeVocab') {
      const id = String(body.id ?? '').trim();
      const store = await getCookieChannelStore();
      const synced = await persistChannelStore({
        ...store,
        vocabs: store.vocabs.filter((vocab) => vocab.id !== id),
      });
      revalidatePath('/vocab');
      return ok({ success: id, synced });
    }

    return fail('Unsupported action type');
  } catch (error) {
    return fail((error as Error).message || 'Request failed', 500);
  }
}
