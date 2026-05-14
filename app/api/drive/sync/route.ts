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
import { readUserSyncState, writeUserSyncState } from '@/lib/sync-store';
import type { ChannelPreferenceStore } from '@/lib/types';
import { mergeVocabs, sameVocabs } from '@/lib/vocab-sync';
import { getEnvChannelIds } from '@/lib/whitelist';
import { DEFAULT_VIEW_PREFERENCES, sameViewPreferences } from '@/lib/view-preferences';

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => b[index] === value);
}

// GET - read Drive, return sync state
export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let cookieStore: ChannelPreferenceStore = {
    channels: [],
    spaces: [],
    view: DEFAULT_VIEW_PREFERENCES,
    viewUpdatedAt: new Date(0).toISOString(),
    updatesChannelIds: [],
    vocabs: [],
    ignoredChannels: [],
    discoverSearches: [],
  };
  let remoteData = null;
  let source = 'none';
  let localMeta = { updatedAt: null as string | null, dirty: false };
  try {
    const [cookie, remote, meta] = await Promise.all([
      getCookieChannelStore(),
      readUserSyncState(session),
      getCookieChannelSyncMeta(),
    ]);
    cookieStore = cookie;
    remoteData = remote.state;
    source = remote.source;
    localMeta = meta;
  } catch {
    return Response.json({ error: 'Failed to read sync state' }, { status: 502 });
  }

  const remoteChannels = remoteData?.channels ?? [];
  const remoteSpaces = remoteData?.spaces ?? [];
  const envIds = getEnvChannelIds();
  const cookieOnly = cookieStore.channels.filter((channel) => !envIds.includes(channel.id));
  const syncedChannels =
    cookieOnly.length === remoteChannels.length &&
    cookieOnly.every((channel, index) =>
      remoteChannels[index]?.id === channel.id && remoteChannels[index]?.space === channel.space,
    );
  const syncedSpaces =
    cookieStore.spaces.length === remoteSpaces.length &&
    cookieStore.spaces.every((space, index) => remoteSpaces[index] === space);
  const syncedView = sameViewPreferences(cookieStore.view, remoteData?.view ?? cookieStore.view);
  const syncedUpdates = sameStringList(cookieStore.updatesChannelIds, remoteData?.updatesChannelIds ?? []);
  const syncedVocabs = sameVocabs(cookieStore.vocabs, remoteData?.vocabs ?? []);
  const syncedIgnored = sameStringList(
    cookieStore.ignoredChannels.map((channel) => channel.id),
    (remoteData?.ignoredChannels ?? []).map((channel) => channel.id),
  );

  return Response.json({
    driveIds: remoteChannels.map((channel) => channel.id),
    cookieIds: cookieStore.channels.map((channel) => channel.id),
    initialized: await hasDriveSyncHydrated(),
    synced: syncedChannels && syncedSpaces && syncedView && syncedUpdates && syncedVocabs && syncedIgnored && !localMeta.dirty,
    updatedAt: remoteData?.updatedAt ?? null,
    source,
  });
}

// POST /api/drive/sync - push local cookie channels to Drive (manual sync by user)
export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const cookieStore = await getCookieChannelStore();
  const localMeta = await getCookieChannelSyncMeta();
  const envIds = getEnvChannelIds();
  const cookieOnly = cookieStore.channels.filter((channel) => !envIds.includes(channel.id));
  const localSpaces = cookieStore.spaces;
  const localView = cookieStore.view;

  try {
    const remote = await readUserSyncState(session);
    const remoteData = remote.state;

    if (remoteData && !localMeta.dirty) {
      const remoteOnly = remoteData.channels.filter((channel) => !envIds.includes(channel.id));
      const mergedVocabs = mergeVocabs(cookieStore.vocabs, remoteData.vocabs);
      const hadLocalVocabExtras = !sameVocabs(mergedVocabs, remoteData.vocabs);

      const replacedLocal =
        cookieOnly.length !== remoteOnly.length ||
        cookieOnly.some((channel, index) =>
          remoteOnly[index]?.id !== channel.id || remoteOnly[index]?.space !== channel.space,
        ) ||
        localSpaces.length !== remoteData.spaces.length ||
        localSpaces.some((space, index) => remoteData.spaces[index] !== space) ||
        !sameViewPreferences(localView, remoteData.view) ||
        !sameStringList(cookieStore.updatesChannelIds, remoteData.updatesChannelIds) ||
        cookieStore.vocabs.length !== mergedVocabs.length;

      await setCookieChannelStore({
        channels: remoteOnly,
        spaces: remoteData.spaces,
        view: remoteData.view,
        viewUpdatedAt: remoteData.viewUpdatedAt,
        updatesChannelIds: remoteData.updatesChannelIds,
        vocabs: mergedVocabs,
        ignoredChannels: remoteData.ignoredChannels,
        discoverSearches: remoteData.discoverSearches,
        activeDiscoverSearchId: remoteData.activeDiscoverSearchId,
      });

      let updatedAt = remoteData.updatedAt;
      if (hadLocalVocabExtras) {
        try {
          const syncedAt = new Date().toISOString();
          await writeUserSyncState(session, {
            channels: remoteOnly,
            spaces: remoteData.spaces,
            view: remoteData.view,
            viewUpdatedAt: remoteData.viewUpdatedAt,
            updatesChannelIds: remoteData.updatesChannelIds,
            vocabs: mergedVocabs,
            ignoredChannels: remoteData.ignoredChannels,
            discoverSearches: remoteData.discoverSearches,
            activeDiscoverSearchId: remoteData.activeDiscoverSearchId,
            quota: remoteData.quota,
          });
          updatedAt = syncedAt;
          await markCookieChannelStoreSynced(syncedAt);
        } catch {
          await markCookieChannelStoreDirty();
        }
      } else {
        await markCookieChannelStoreSynced(remoteData.updatedAt);
      }
      await markDriveSyncHydrated();

      return Response.json({
        ok: true,
        initialized: true,
        driveWins: true,
        replacedLocal,
        updatedAt,
        source: remote.source,
        channelIds: remoteOnly.map((channel) => channel.id),
      });
    }

    const syncedAt = new Date().toISOString();
    const written = await writeUserSyncState(session, {
      channels: cookieOnly,
      spaces: localSpaces,
      view: localView,
      viewUpdatedAt: cookieStore.viewUpdatedAt,
      updatesChannelIds: cookieStore.updatesChannelIds,
      vocabs: cookieStore.vocabs,
      ignoredChannels: cookieStore.ignoredChannels,
      discoverSearches: cookieStore.discoverSearches,
      activeDiscoverSearchId: cookieStore.activeDiscoverSearchId,
      quota: remoteData?.quota,
    });
    await markCookieChannelStoreSynced(syncedAt);
    await markDriveSyncHydrated();

    return Response.json({
      ok: true,
      initialized: true,
      seededFromLocal: true,
      updatedAt: syncedAt,
      source: written.source,
      driveBackupOk: written.driveBackupOk,
      channelIds: cookieOnly.map((channel) => channel.id),
    });
  } catch {
    return Response.json({ error: 'Failed to write sync state' }, { status: 502 });
  }
}

// PUT /api/drive/sync - pull Drive channels into cookie (called on login, Drive wins)
export async function PUT() {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let remoteData = null;
  let source = 'none';
  try {
    const remote = await readUserSyncState(session);
    remoteData = remote.state;
    source = remote.source;
  } catch {
    return Response.json({ error: 'Failed to pull channels from sync store' }, { status: 502 });
  }

  if (!remoteData) {
    await markDriveSyncHydrated();
    return Response.json({ ok: true, initialized: true, channelIds: [] });
  }

  const envIds = getEnvChannelIds();
  await setCookieChannelStore({
    channels: remoteData.channels.filter((channel) => !envIds.includes(channel.id)),
    spaces: remoteData.spaces,
    view: remoteData.view,
    viewUpdatedAt: remoteData.viewUpdatedAt,
    updatesChannelIds: remoteData.updatesChannelIds,
    vocabs: remoteData.vocabs,
    ignoredChannels: remoteData.ignoredChannels,
    discoverSearches: remoteData.discoverSearches,
    activeDiscoverSearchId: remoteData.activeDiscoverSearchId,
  });
  await markCookieChannelStoreSynced(remoteData.updatedAt);
  await markDriveSyncHydrated();
  return Response.json({ ok: true, initialized: true, source, channelIds: remoteData.channels.map((channel) => channel.id) });
}
