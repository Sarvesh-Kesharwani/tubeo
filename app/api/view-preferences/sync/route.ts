import {
  getCookieChannelSyncMeta,
  getCookieChannelStore,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  setCookieChannelStore,
  setCookieViewPreferences,
} from '@/lib/channels-cookie';
import { readDriveChannels, writeDriveChannels } from '@/lib/drive';
import { getSession } from '@/lib/session';
import type { ViewPreferences } from '@/lib/types';
import { getEnvChannelIds } from '@/lib/whitelist';
import { normalizeViewPreferences, sameViewPreferences } from '@/lib/view-preferences';

const EPOCH = new Date(0).toISOString();

function newerOrEqual(a: string, b: string): boolean {
  return Date.parse(a || EPOCH) >= Date.parse(b || EPOCH);
}

function response(filters: ViewPreferences, updatedAt: string, source: 'local' | 'drive' | 'cookie', synced: boolean) {
  return Response.json({ ok: true, filters, updatedAt, source, synced });
}

export async function POST(req: Request) {
  let body: { filters?: Partial<ViewPreferences>; updatedAt?: string };
  try {
    body = (await req.json()) as { filters?: Partial<ViewPreferences>; updatedAt?: string };
  } catch {
    body = {};
  }

  const localFilters = normalizeViewPreferences(body.filters);
  const localUpdatedAt = body.updatedAt || EPOCH;
  const cookieStore = await getCookieChannelStore();
  const session = await getSession();

  if (!session?.accessToken) {
    if (newerOrEqual(localUpdatedAt, cookieStore.viewUpdatedAt)) {
      await setCookieViewPreferences(localFilters, localUpdatedAt);
      await markCookieChannelStoreDirty(localUpdatedAt);
      return response(localFilters, localUpdatedAt, 'local', false);
    }

    return response(cookieStore.view, cookieStore.viewUpdatedAt, 'cookie', false);
  }

  try {
    const driveData = await readDriveChannels(session.accessToken);
    const driveUpdatedAt = driveData?.viewUpdatedAt ?? EPOCH;
    const localWins = newerOrEqual(localUpdatedAt, driveUpdatedAt);

    if (driveData && !localWins) {
      await setCookieChannelStore({
        channels: driveData.channels.filter((channel) => !getEnvChannelIds().includes(channel.id)),
        spaces: driveData.spaces,
        view: driveData.view,
        viewUpdatedAt: driveData.viewUpdatedAt,
        updatesChannelIds: driveData.updatesChannelIds,
        savedVideos: driveData.savedVideos,
      });
      await markCookieChannelStoreSynced(driveData.updatedAt);
      return response(driveData.view, driveData.viewUpdatedAt, 'drive', true);
    }

    if (newerOrEqual(localUpdatedAt, cookieStore.viewUpdatedAt) || !sameViewPreferences(localFilters, cookieStore.view)) {
      await setCookieViewPreferences(localFilters, localUpdatedAt);
    }

    const [latestStore, latestMeta] = await Promise.all([getCookieChannelStore(), getCookieChannelSyncMeta()]);
    const envIds = getEnvChannelIds();
    const nonViewStore =
      latestMeta.dirty || !driveData
        ? latestStore
        : {
            channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
            spaces: driveData.spaces,
            view: latestStore.view,
            viewUpdatedAt: latestStore.viewUpdatedAt,
            updatesChannelIds: driveData.updatesChannelIds,
            savedVideos: driveData.savedVideos,
          };
    const nextStore = {
      channels: nonViewStore.channels,
      spaces: nonViewStore.spaces,
      view: localFilters,
      viewUpdatedAt: localUpdatedAt,
      updatesChannelIds: nonViewStore.updatesChannelIds,
      savedVideos: nonViewStore.savedVideos,
    };
    await setCookieChannelStore(nextStore);
    await writeDriveChannels(session.accessToken, {
      channels: nextStore.channels.filter((channel) => !envIds.includes(channel.id)),
      spaces: nextStore.spaces,
      view: localFilters,
      viewUpdatedAt: localUpdatedAt,
      updatesChannelIds: nextStore.updatesChannelIds,
      savedVideos: nextStore.savedVideos,
      quota: driveData?.quota,
    });
    await markCookieChannelStoreSynced(new Date().toISOString());
    return response(localFilters, localUpdatedAt, 'local', true);
  } catch {
    if (newerOrEqual(localUpdatedAt, cookieStore.viewUpdatedAt)) {
      await setCookieViewPreferences(localFilters, localUpdatedAt);
      await markCookieChannelStoreDirty(localUpdatedAt);
      return response(localFilters, localUpdatedAt, 'local', false);
    }

    return response(cookieStore.view, cookieStore.viewUpdatedAt, 'cookie', false);
  }
}
