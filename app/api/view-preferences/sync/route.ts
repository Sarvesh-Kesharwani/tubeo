import {
  getCookieChannelStore,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  setCookieViewPreferences,
} from '@/lib/channels-cookie';
import { readDriveChannels, writeDriveChannels } from '@/lib/drive';
import { getSession } from '@/lib/session';
import type { ViewPreferences } from '@/lib/types';
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
      await setCookieViewPreferences(driveData.view, driveData.viewUpdatedAt);
      await markCookieChannelStoreSynced(driveData.updatedAt);
      return response(driveData.view, driveData.viewUpdatedAt, 'drive', true);
    }

    await setCookieViewPreferences(localFilters, localUpdatedAt);

    if (driveData) {
      const envIds = getEnvChannelIds();
      await writeDriveChannels(session.accessToken, {
        channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
        spaces: driveData.spaces,
        view: localFilters,
        viewUpdatedAt: localUpdatedAt,
        updatesChannelIds: driveData.updatesChannelIds,
        vocabs: driveData.vocabs,
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
