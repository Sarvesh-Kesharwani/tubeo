import {
  getCookieChannelStore,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  setCookieChannelStore,
} from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { readUserSyncState, writeUserSyncState } from '@/lib/sync-store';
import type { DiscoverSearchFilters } from '@/lib/types';

function normalizePath(value: unknown): string | undefined {
  const path = String(value ?? '').trim();
  if (!path.startsWith('/')) return undefined;
  if (path.startsWith('/api/') || path.startsWith('/_next/')) return undefined;
  return path.slice(0, 160);
}

function normalizeDiscoverDraft(value: unknown): DiscoverSearchFilters | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<DiscoverSearchFilters>;
  return {
    q: item.q?.trim() ?? '',
    order: item.order?.trim() || 'relevance',
    regionCode: item.regionCode?.trim() ?? '',
    relevanceLanguage: item.relevanceLanguage?.trim() ?? '',
    safeSearch: item.safeSearch?.trim() || 'moderate',
    channelType: item.channelType?.trim() || 'any',
    topicId: item.topicId?.trim() ?? '',
    publishedAfter: item.publishedAfter?.trim() ?? '',
    publishedBefore: item.publishedBefore?.trim() ?? '',
  };
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const session = await getSession();
  const cookieStore = await getCookieChannelStore();
  const remote = session?.user ? await readUserSyncState(session).catch(() => ({ state: null })) : { state: null };
  const store = remote.state ?? cookieStore;

  const lastPagePath = normalizePath(body.lastPagePath);
  const discoverDraft = normalizeDiscoverDraft(body.discoverDraft);
  const nextStore = {
    ...store,
    lastPagePath: lastPagePath ?? store.lastPagePath,
    discoverDraft: discoverDraft ?? store.discoverDraft,
  };

  if (
    nextStore.lastPagePath === store.lastPagePath &&
    JSON.stringify(nextStore.discoverDraft ?? null) === JSON.stringify(store.discoverDraft ?? null)
  ) {
    return Response.json({ ok: true, changed: false });
  }

  await setCookieChannelStore(nextStore);
  if (session?.user) {
    try {
      const written = await writeUserSyncState(session, nextStore);
      await markCookieChannelStoreSynced(written.state?.updatedAt ?? new Date().toISOString());
      return Response.json({ ok: true, changed: true, synced: true });
    } catch {
      await markCookieChannelStoreDirty();
      return Response.json({ ok: true, changed: true, synced: false });
    }
  }

  await markCookieChannelStoreDirty();
  return Response.json({ ok: true, changed: true, synced: false });
}
