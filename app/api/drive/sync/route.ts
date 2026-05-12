import { readDriveChannels, writeDriveChannels } from '@/lib/drive';
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
import type { ChannelPreferenceStore } from '@/lib/types';
import { getEnvChannelIds } from '@/lib/whitelist';
import { DEFAULT_VIEW_PREFERENCES, sameViewPreferences } from '@/lib/view-preferences';

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => b[index] === value);
}

function sameSavedVideos(a: ChannelPreferenceStore['savedVideos'], b: ChannelPreferenceStore['savedVideos']): boolean {
  return (
    a.length === b.length &&
    a.every((video, index) => {
      const other = b[index];
      return (
        other?.id === video.id &&
        other.url === video.url &&
        other.note === video.note &&
        other.addedAt === video.addedAt
      );
    })
  );
}

// GET - read Drive, return { driveIds, cookieIds, synced }
export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let cookieStore: ChannelPreferenceStore = {
    channels: [],
    spaces: [],
    view: DEFAULT_VIEW_PREFERENCES,
    viewUpdatedAt: new Date(0).toISOString(),
    updatesChannelIds: [],
    savedVideos: [],
  };
  let driveData = null;
  let localMeta = { updatedAt: null as string | null, dirty: false };
  try {
    [cookieStore, driveData, localMeta] = await Promise.all([
      getCookieChannelStore(),
      readDriveChannels(session.accessToken),
      getCookieChannelSyncMeta(),
    ]);
  } catch {
    return Response.json({ error: 'Failed to read Drive sync state' }, { status: 502 });
  }

  const driveChannels = driveData?.channels ?? [];
  const driveSpaces = driveData?.spaces ?? [];
  const envIds = getEnvChannelIds();
  const cookieOnly = cookieStore.channels.filter((channel) => !envIds.includes(channel.id));
  const syncedChannels =
    cookieOnly.length === driveChannels.length &&
    cookieOnly.every((channel, index) =>
      driveChannels[index]?.id === channel.id && driveChannels[index]?.space === channel.space,
    );
  const syncedSpaces =
    cookieStore.spaces.length === driveSpaces.length &&
    cookieStore.spaces.every((space, index) => driveSpaces[index] === space);
  const syncedView = sameViewPreferences(cookieStore.view, driveData?.view ?? cookieStore.view);
  const syncedUpdates = sameStringList(cookieStore.updatesChannelIds, driveData?.updatesChannelIds ?? []);
  const syncedSavedVideos = sameSavedVideos(cookieStore.savedVideos, driveData?.savedVideos ?? []);

  return Response.json({
    driveIds: driveChannels.map((channel) => channel.id),
    cookieIds: cookieStore.channels.map((channel) => channel.id),
    initialized: await hasDriveSyncHydrated(),
    synced: syncedChannels && syncedSpaces && syncedView && syncedUpdates && syncedSavedVideos && !localMeta.dirty,
    updatedAt: driveData?.updatedAt ?? null,
  });
}

// POST /api/drive/sync - push local cookie channels to Drive (manual sync by user)
export async function POST() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const cookieStore = await getCookieChannelStore();
  const localMeta = await getCookieChannelSyncMeta();
  const envIds = getEnvChannelIds();
  const cookieOnly = cookieStore.channels.filter((channel) => !envIds.includes(channel.id));
  const localSpaces = cookieStore.spaces;
  const localView = cookieStore.view;

  try {
    const driveData = await readDriveChannels(session.accessToken);

    if (driveData && !localMeta.dirty) {
      const driveOnly = driveData.channels.filter((channel) => !envIds.includes(channel.id));
      const driveSavedIds = new Set(driveData.savedVideos.map((video) => video.id));
      const localExtraSavedVideos = cookieStore.savedVideos.filter((video) => !driveSavedIds.has(video.id));
      const mergedSavedVideos = [...localExtraSavedVideos, ...driveData.savedVideos];
      const hadLocalSavedExtras = localExtraSavedVideos.length > 0;

      const replacedLocal =
        cookieOnly.length !== driveOnly.length ||
        cookieOnly.some((channel, index) =>
          driveOnly[index]?.id !== channel.id || driveOnly[index]?.space !== channel.space,
        ) ||
        localSpaces.length !== driveData.spaces.length ||
        localSpaces.some((space, index) => driveData.spaces[index] !== space) ||
        !sameViewPreferences(localView, driveData.view) ||
        !sameStringList(cookieStore.updatesChannelIds, driveData.updatesChannelIds) ||
        !sameSavedVideos(cookieStore.savedVideos, mergedSavedVideos);

      await setCookieChannelStore({
        channels: driveOnly,
        spaces: driveData.spaces,
        view: driveData.view,
        viewUpdatedAt: driveData.viewUpdatedAt,
        updatesChannelIds: driveData.updatesChannelIds,
        savedVideos: mergedSavedVideos,
      });

      let updatedAt = driveData.updatedAt;
      if (hadLocalSavedExtras) {
        try {
          const syncedAt = new Date().toISOString();
          await writeDriveChannels(session.accessToken, {
            channels: driveOnly,
            spaces: driveData.spaces,
            view: driveData.view,
            viewUpdatedAt: driveData.viewUpdatedAt,
            updatesChannelIds: driveData.updatesChannelIds,
            savedVideos: mergedSavedVideos,
            quota: driveData.quota,
          });
          updatedAt = syncedAt;
          await markCookieChannelStoreSynced(syncedAt);
        } catch {
          await markCookieChannelStoreDirty();
        }
      } else {
        await markCookieChannelStoreSynced(driveData.updatedAt);
      }
      await markDriveSyncHydrated();

      return Response.json({
        ok: true,
        initialized: true,
        driveWins: true,
        replacedLocal,
        updatedAt,
        channelIds: driveOnly.map((channel) => channel.id),
      });
    }

    const syncedAt = new Date().toISOString();
    await writeDriveChannels(session.accessToken, {
      channels: cookieOnly,
      spaces: localSpaces,
      view: localView,
      viewUpdatedAt: cookieStore.viewUpdatedAt,
      updatesChannelIds: cookieStore.updatesChannelIds,
      savedVideos: cookieStore.savedVideos,
      quota: driveData?.quota,
    });
    await markCookieChannelStoreSynced(syncedAt);
    await markDriveSyncHydrated();

    return Response.json({
      ok: true,
      initialized: true,
      seededFromLocal: true,
      updatedAt: syncedAt,
      channelIds: cookieOnly.map((channel) => channel.id),
    });
  } catch {
    return Response.json({ error: 'Failed to write Drive sync state' }, { status: 502 });
  }
}

// PUT /api/drive/sync - pull Drive channels into cookie (called on login, Drive wins)
export async function PUT() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let driveData = null;
  try {
    driveData = await readDriveChannels(session.accessToken);
  } catch {
    return Response.json({ error: 'Failed to pull channels from Drive' }, { status: 502 });
  }

  if (!driveData) {
    await markDriveSyncHydrated();
    return Response.json({ ok: true, initialized: true, channelIds: [] });
  }

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
  await markDriveSyncHydrated();
  return Response.json({ ok: true, initialized: true, channelIds: driveData.channels.map((channel) => channel.id) });
}
