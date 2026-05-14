import {
  getCookieChannelStore,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  setCookieViewPreferences,
} from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { readUserSyncState, writeUserSyncState } from '@/lib/sync-store';
import type { ViewPreferences } from '@/lib/types';
import { mergeVocabs, sameVocabs } from '@/lib/vocab-sync';
import { getEnvChannelIds } from '@/lib/whitelist';
import { normalizeViewPreferences } from '@/lib/view-preferences';

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

  if (!session?.user) {
    if (newerOrEqual(localUpdatedAt, cookieStore.viewUpdatedAt)) {
      await setCookieViewPreferences(localFilters, localUpdatedAt);
      await markCookieChannelStoreDirty(localUpdatedAt);
      return response(localFilters, localUpdatedAt, 'local', false);
    }

    return response(cookieStore.view, cookieStore.viewUpdatedAt, 'cookie', false);
  }

  try {
    const remote = await readUserSyncState(session);
    const driveData = remote.state;
    const driveUpdatedAt = driveData?.viewUpdatedAt ?? EPOCH;
    const localWins = newerOrEqual(localUpdatedAt, driveUpdatedAt);

    if (driveData && !localWins) {
      const mergedVocabs = mergeVocabs(cookieStore.vocabs, driveData.vocabs);
      await setCookieViewPreferences(driveData.view, driveData.viewUpdatedAt);
      if (!sameVocabs(mergedVocabs, driveData.vocabs)) {
        const envIds = getEnvChannelIds();
        const syncedAt = new Date().toISOString();
        await writeUserSyncState(session, {
          channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
          spaces: driveData.spaces,
          view: driveData.view,
          viewUpdatedAt: driveData.viewUpdatedAt,
          updatesChannelIds: driveData.updatesChannelIds,
          vocabs: mergedVocabs,
          ignoredChannels: driveData.ignoredChannels,
          discoverSearches: driveData.discoverSearches,
          activeDiscoverSearchId: driveData.activeDiscoverSearchId,
          quota: driveData.quota,
        });
        await markCookieChannelStoreSynced(syncedAt);
      } else {
        await markCookieChannelStoreSynced(driveData.updatedAt);
      }
      return response(driveData.view, driveData.viewUpdatedAt, 'drive', true);
    }

    await setCookieViewPreferences(localFilters, localUpdatedAt);

    if (driveData) {
      const envIds = getEnvChannelIds();
      await writeUserSyncState(session, {
        channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
        spaces: driveData.spaces,
        view: localFilters,
        viewUpdatedAt: localUpdatedAt,
        updatesChannelIds: driveData.updatesChannelIds,
        vocabs: mergeVocabs(cookieStore.vocabs, driveData.vocabs),
        ignoredChannels: driveData.ignoredChannels,
        discoverSearches: driveData.discoverSearches,
        activeDiscoverSearchId: driveData.activeDiscoverSearchId,
        quota: driveData.quota,
      });
      await markCookieChannelStoreSynced(new Date().toISOString());
    } else {
      await markCookieChannelStoreDirty(localUpdatedAt);
    }

    return response(localFilters, localUpdatedAt, 'local', Boolean(driveData));
  } catch {
    if (newerOrEqual(localUpdatedAt, cookieStore.viewUpdatedAt)) {
      await setCookieViewPreferences(localFilters, localUpdatedAt);
      await markCookieChannelStoreDirty(localUpdatedAt);
      return response(localFilters, localUpdatedAt, 'local', false);
    }

    return response(cookieStore.view, cookieStore.viewUpdatedAt, 'cookie', false);
  }
}
