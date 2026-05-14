import { cookies } from 'next/headers';
import { normalizeSpaceName } from './spaces';
import {
  DEFAULT_CHANNEL_SPACE,
  normalizeVocabWord,
  vocabIdFromWord,
  type ChannelPreference,
  type ChannelPreferenceStore,
  type DiscoverSearchFilters,
  type DiscoverSearchRecord,
  type DiscoveredChannel,
  type ViewPreferences,
  type VocabItem,
  type VocabMeaningStatus,
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
const COOKIE_CHUNK_SIZE = 1500;
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

function normalizeVocabStatus(status: unknown): VocabMeaningStatus {
  return status === 'ready' || status === 'failed' ? status : 'pending';
}

function normalizeVocabs(value: VocabItem[] | undefined): VocabItem[] {
  const seen = new Set<string>();
  const out: VocabItem[] = [];

  for (const item of value ?? []) {
    const word = normalizeVocabWord(item?.word ?? '');
    if (!word) continue;
    const id = (item?.id ?? '').trim() || vocabIdFromWord(word);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      word,
      meaning: typeof item.meaning === 'string' ? item.meaning : '',
      status: normalizeVocabStatus(item.status),
      addedAt: item.addedAt || new Date().toISOString(),
      meaningUpdatedAt: item.meaningUpdatedAt || item.addedAt || new Date().toISOString(),
    });
  }

  return out;
}

function normalizeIgnoredChannels(value: DiscoveredChannel[] | undefined): DiscoveredChannel[] {
  const seen = new Set<string>();
  const out: DiscoveredChannel[] = [];

  for (const item of value ?? []) {
    const id = item?.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: item.title?.trim() || id,
      thumbnail: item.thumbnail || '',
      description: item.description || '',
      ignoredAt: item.ignoredAt || new Date().toISOString(),
      subscriberCount: typeof item.subscriberCount === 'number' ? item.subscriberCount : undefined,
      viewCount: typeof item.viewCount === 'number' ? item.viewCount : undefined,
      videoCount: typeof item.videoCount === 'number' ? item.videoCount : undefined,
      country: item.country || undefined,
    });
  }

  return out;
}

function normalizeDiscoverFilters(value: Partial<DiscoverSearchFilters> | undefined): DiscoverSearchFilters {
  return {
    q: value?.q?.trim() ?? '',
    order: value?.order?.trim() || 'relevance',
    regionCode: value?.regionCode?.trim() ?? '',
    relevanceLanguage: value?.relevanceLanguage?.trim() ?? '',
    safeSearch: value?.safeSearch?.trim() || 'moderate',
    channelType: value?.channelType?.trim() || 'any',
    topicId: value?.topicId?.trim() ?? '',
    publishedAfter: value?.publishedAfter?.trim() ?? '',
    publishedBefore: value?.publishedBefore?.trim() ?? '',
  };
}

function normalizeDiscoverSearches(value: DiscoverSearchRecord[] | undefined): DiscoverSearchRecord[] {
  const seen = new Set<string>();
  const out: DiscoverSearchRecord[] = [];

  for (const item of value ?? []) {
    const id = item?.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pages = (item.pages ?? [])
      .map((page) => ({
        pageNumber: Math.max(1, Math.floor(Number(page.pageNumber) || 1)),
        pageToken: page.pageToken || undefined,
        nextPageToken: page.nextPageToken || undefined,
        channels: normalizeIgnoredChannels(page.channels),
        hiddenIgnored: Math.max(0, Math.floor(Number(page.hiddenIgnored) || 0)),
        quotaUnits: Math.max(0, Math.floor(Number(page.quotaUnits) || 0)),
        searchedAt: page.searchedAt || item.updatedAt || new Date().toISOString(),
      }))
      .sort((a, b) => a.pageNumber - b.pageNumber);
    out.push({
      id,
      filters: normalizeDiscoverFilters(item.filters),
      pages,
      activePage: Math.max(1, Math.floor(Number(item.activePage) || 1)),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
    });
  }

  return out
    .filter((item) => item.filters.q || item.pages.length > 0)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 50);
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
  const vocabs = normalizeVocabs(store.vocabs);
  const ignoredChannels = normalizeIgnoredChannels(store.ignoredChannels);
  const discoverSearches = normalizeDiscoverSearches(store.discoverSearches);
  const activeDiscoverSearchId = discoverSearches.some((search) => search.id === store.activeDiscoverSearchId)
    ? store.activeDiscoverSearchId
    : discoverSearches[0]?.id;
  const lastPagePath =
    typeof store.lastPagePath === 'string' && store.lastPagePath.startsWith('/')
      ? store.lastPagePath
      : undefined;

  return {
    channels,
    spaces,
    view,
    viewUpdatedAt,
    updatesChannelIds,
    vocabs,
    ignoredChannels,
    discoverSearches,
    activeDiscoverSearchId,
    discoverDraft: normalizeDiscoverFilters(store.discoverDraft),
    lastPagePath,
  };
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
      vocabs: [],
      ignoredChannels: [],
      discoverSearches: [],
      discoverDraft: normalizeDiscoverFilters(undefined),
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
      vocabs: [],
      ignoredChannels: [],
      discoverSearches: [],
      discoverDraft: normalizeDiscoverFilters(undefined),
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
          vocabs?: VocabItem[];
          ignoredChannels?: DiscoveredChannel[];
          discoverSearches?: DiscoverSearchRecord[];
          activeDiscoverSearchId?: string;
          discoverDraft?: Partial<DiscoverSearchFilters>;
          lastPagePath?: string;
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
      vocabs: Array.isArray(parsed) ? [] : parsed?.vocabs ?? [],
      ignoredChannels: Array.isArray(parsed) ? [] : parsed?.ignoredChannels ?? [],
      discoverSearches: Array.isArray(parsed) ? [] : parsed?.discoverSearches ?? [],
      activeDiscoverSearchId: Array.isArray(parsed) ? undefined : parsed?.activeDiscoverSearchId,
      discoverDraft: Array.isArray(parsed) ? undefined : normalizeDiscoverFilters(parsed?.discoverDraft),
      lastPagePath: Array.isArray(parsed) ? undefined : parsed?.lastPagePath,
    });
  } catch {
    return {
      channels: [],
      spaces: [DEFAULT_CHANNEL_SPACE],
      view: DEFAULT_VIEW_PREFERENCES,
      viewUpdatedAt: EPOCH,
      updatesChannelIds: [],
      vocabs: [],
      ignoredChannels: [],
      discoverSearches: [],
      discoverDraft: normalizeDiscoverFilters(undefined),
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
  const normalized = normalizeStore(store);
  const value = JSON.stringify({
    ...normalized,
    discoverSearches: [],
    activeDiscoverSearchId: normalized.activeDiscoverSearchId,
    discoverDraft: normalized.discoverDraft,
    lastPagePath: normalized.lastPagePath,
  });
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
    vocabs: existing.vocabs,
    ignoredChannels: existing.ignoredChannels,
    discoverSearches: existing.discoverSearches,
    activeDiscoverSearchId: existing.activeDiscoverSearchId,
    discoverDraft: existing.discoverDraft,
    lastPagePath: existing.lastPagePath,
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
    vocabs: existing.vocabs,
    ignoredChannels: existing.ignoredChannels,
    discoverSearches: existing.discoverSearches,
    activeDiscoverSearchId: existing.activeDiscoverSearchId,
    discoverDraft: existing.discoverDraft,
    lastPagePath: existing.lastPagePath,
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
    vocabs: existing.vocabs,
    ignoredChannels: existing.ignoredChannels,
    discoverSearches: existing.discoverSearches,
    activeDiscoverSearchId: existing.activeDiscoverSearchId,
    discoverDraft: existing.discoverDraft,
    lastPagePath: existing.lastPagePath,
  });
}

export async function clearCookieChannelIds(): Promise<void> {
  const jar = await cookies();
  clearCookieStoreChunks(jar);
  jar.delete(DRIVE_READY_COOKIE);
  jar.delete(LOCAL_UPDATED_COOKIE);
  jar.delete(LOCAL_DIRTY_COOKIE);
}
