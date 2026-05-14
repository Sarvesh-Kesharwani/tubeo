import {
  getCookieChannelStore,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  setCookieChannelStore,
} from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { readUserSyncState, writeUserSyncState } from '@/lib/sync-store';
import type { ChannelPreferenceStore, DiscoverSearchFilters, DiscoverSearchPage, DiscoverSearchRecord } from '@/lib/types';
import { searchYouTubeChannels, type ChannelSearchOrder, type ChannelSearchSafeSearch, type ChannelSearchType } from '@/lib/youtube';

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function filtersFromParams(url: URL): DiscoverSearchFilters {
  return {
    q: (url.searchParams.get('q') ?? '').trim(),
    order: pick<ChannelSearchOrder>(
      url.searchParams.get('order'),
      ['date', 'rating', 'relevance', 'title', 'videoCount', 'viewCount'],
      'relevance',
    ),
    regionCode: (url.searchParams.get('regionCode') ?? '').trim(),
    relevanceLanguage: (url.searchParams.get('relevanceLanguage') ?? '').trim(),
    safeSearch: pick<ChannelSearchSafeSearch>(
      url.searchParams.get('safeSearch'),
      ['moderate', 'none', 'strict'],
      'moderate',
    ),
    channelType: pick<ChannelSearchType>(
      url.searchParams.get('channelType'),
      ['any', 'show'],
      'any',
    ),
    topicId: (url.searchParams.get('topicId') ?? '').trim(),
    publishedAfter: (url.searchParams.get('publishedAfter') ?? '').trim(),
    publishedBefore: (url.searchParams.get('publishedBefore') ?? '').trim(),
  };
}

function sameFilters(a: DiscoverSearchFilters, b: DiscoverSearchFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function newSearchId(): string {
  return `sr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getSyncedStore(): Promise<{ store: ChannelPreferenceStore; session: Awaited<ReturnType<typeof getSession>> }> {
  const session = await getSession();
  const cookieStore = await getCookieChannelStore();
  if (!session?.user) return { store: cookieStore, session };

  try {
    const remote = await readUserSyncState(session);
    if (remote.state) {
      await setCookieChannelStore(remote.state);
      await markCookieChannelStoreSynced(remote.state.updatedAt);
      return { store: remote.state, session };
    }
  } catch {
    return { store: cookieStore, session };
  }

  return { store: cookieStore, session };
}

async function persistStore(session: Awaited<ReturnType<typeof getSession>>, store: ChannelPreferenceStore) {
  await setCookieChannelStore(store);
  if (!session?.user) {
    await markCookieChannelStoreDirty();
    return;
  }

  try {
    const written = await writeUserSyncState(session, store);
    await markCookieChannelStoreSynced(written.state?.updatedAt ?? new Date().toISOString());
  } catch {
    await markCookieChannelStoreDirty();
  }
}

function upsertSearch(store: ChannelPreferenceStore, search: DiscoverSearchRecord): ChannelPreferenceStore {
  const searches = [search, ...store.discoverSearches.filter((item) => item.id !== search.id)].slice(0, 50);
  return {
    ...store,
    discoverSearches: searches,
    activeDiscoverSearchId: search.id,
  };
}

function responsePayload(
  store: ChannelPreferenceStore,
  search: DiscoverSearchRecord | null,
  page: DiscoverSearchPage | null,
  existingIds: string[],
  hiddenSelectedOverride?: number,
) {
  const existingSet = new Set(existingIds);
  const rawChannels = page?.channels ?? [];
  const visibleChannels = rawChannels.filter((channel) => !existingSet.has(channel.id));
  const hiddenSelected =
    typeof hiddenSelectedOverride === 'number'
      ? hiddenSelectedOverride
      : rawChannels.length - visibleChannels.length;
  return Response.json({
    ok: true,
    searchId: search?.id,
    filters: search?.filters,
    pageNumber: page?.pageNumber ?? 1,
    totalPagesCached: search?.pages.length ?? 0,
    channels: visibleChannels,
    nextPageToken: page?.nextPageToken,
    hiddenIgnored: page?.hiddenIgnored ?? 0,
    hiddenSelected,
    quotaUnits: page?.quotaUnits ?? 0,
    existingIds,
    ignoredChannels: store.ignoredChannels,
    searches: store.discoverSearches,
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { store, session } = await getSyncedStore();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }
  const existingIds = store.channels.map((channel) => channel.id);
  const ignoredIds = store.ignoredChannels.map((channel) => channel.id);
  const filters = filtersFromParams(url);
  const requestedPage = Math.max(1, Math.min(50, Number(url.searchParams.get('page') ?? 1) || 1));
  const historyId = (url.searchParams.get('historyId') ?? '').trim();
  const cachedOnly = url.searchParams.get('cached') === '1';

  if (!filters.q && !historyId) {
    const active = store.discoverSearches.find((search) => search.id === store.activeDiscoverSearchId) ?? store.discoverSearches[0] ?? null;
    const activePage = active?.pages.find((page) => page.pageNumber === active.activePage) ?? active?.pages[0] ?? null;
    return responsePayload(store, active, activePage, existingIds);
  }

  let search =
    (historyId ? store.discoverSearches.find((item) => item.id === historyId) : null) ??
    (filters.q ? store.discoverSearches.find((item) => sameFilters(item.filters, filters)) : null) ??
    null;
  const isNewSearch = Boolean(filters.q && (!search || !sameFilters(search.filters, filters) || !historyId));

  if (isNewSearch || !search) {
    const now = new Date().toISOString();
    search = {
      id: newSearchId(),
      filters,
      pages: [],
      activePage: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (cachedOnly) {
    const cachedPage = search.pages.find((page) => page.pageNumber === requestedPage) ?? search.pages[0] ?? null;
    return responsePayload(store, search, cachedPage, existingIds);
  }

  try {
    let pages = [...search.pages];
    let currentPage = pages.find((page) => page.pageNumber === requestedPage) ?? null;
    let quotaTotal = 0;
    let hiddenSelectedFromFetch: number | undefined;

    while (!currentPage) {
      const lastPage = pages[pages.length - 1];
      const nextPageNumber = lastPage ? lastPage.pageNumber + 1 : 1;
      if (nextPageNumber > requestedPage || (lastPage && !lastPage.nextPageToken)) break;

      const result = await searchYouTubeChannels({
        q: search.filters.q,
        order: search.filters.order as ChannelSearchOrder,
        regionCode: search.filters.regionCode || undefined,
        relevanceLanguage: search.filters.relevanceLanguage || undefined,
        safeSearch: search.filters.safeSearch as ChannelSearchSafeSearch,
        channelType: search.filters.channelType as ChannelSearchType,
        publishedAfter: search.filters.publishedAfter || undefined,
        publishedBefore: search.filters.publishedBefore || undefined,
        topicId: search.filters.topicId || undefined,
        pageToken: lastPage?.nextPageToken,
        ignoredIds,
        existingIds,
      });
      quotaTotal += result.quotaUnits;
      hiddenSelectedFromFetch = (hiddenSelectedFromFetch ?? 0) + result.hiddenSelected;

      const page: DiscoverSearchPage = {
        pageNumber: nextPageNumber,
        pageToken: lastPage?.nextPageToken,
        nextPageToken: result.nextPageToken,
        channels: result.channels,
        hiddenIgnored: result.hiddenIgnored,
        quotaUnits: result.quotaUnits,
        searchedAt: new Date().toISOString(),
      };
      pages = [...pages.filter((item) => item.pageNumber !== page.pageNumber), page].sort((a, b) => a.pageNumber - b.pageNumber);
      currentPage = page.pageNumber === requestedPage ? page : null;
    }

    currentPage = currentPage ?? pages.find((page) => page.pageNumber === search.activePage) ?? pages[0] ?? null;
    const updatedSearch: DiscoverSearchRecord = {
      ...search,
      pages,
      activePage: currentPage?.pageNumber ?? 1,
      updatedAt: new Date().toISOString(),
    };
    const nextStore: ChannelPreferenceStore = {
      ...upsertSearch(store, updatedSearch),
      discoverDraft: updatedSearch.filters,
    };
    await persistStore(session, nextStore);

    return responsePayload(
      nextStore,
      updatedSearch,
      currentPage ? { ...currentPage, quotaUnits: quotaTotal || currentPage.quotaUnits } : null,
      existingIds,
      hiddenSelectedFromFetch,
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || 'Channel search failed.' },
      { status: 500 },
    );
  }
}
