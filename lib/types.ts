// Core domain types. Keep minimal + extensible.

export type TimeRange = '1d' | '3d' | '7d' | '30d' | '180d' | '365d' | 'all';
export type MediaFilter = 'all' | 'videos' | 'shorts';
export const DEFAULT_CHANNEL_SPACE = 'ALL';
export const CHANNELS_OVERVIEW_SPACE = 'all';

export interface Channel {
  id: string;
  title: string;
  thumbnail: string;
  uploadsPlaylistId: string;
}

export interface ChannelPreference {
  id: string;
  space: string;
}

export interface DiscoveredChannel {
  id: string;
  title: string;
  thumbnail: string;
  description?: string;
  ignoredAt?: string;
  subscriberCount?: number;
  viewCount?: number;
  videoCount?: number;
  country?: string;
}

export interface DiscoverSearchFilters {
  q: string;
  order: string;
  regionCode: string;
  relevanceLanguage: string;
  safeSearch: string;
  channelType: string;
  topicId: string;
  publishedAfter: string;
  publishedBefore: string;
}

export interface DiscoverSearchPage {
  pageNumber: number;
  pageToken?: string;
  nextPageToken?: string;
  channels: DiscoveredChannel[];
  hiddenIgnored: number;
  quotaUnits: number;
  searchedAt: string;
}

export interface DiscoverSearchRecord {
  id: string;
  filters: DiscoverSearchFilters;
  pages: DiscoverSearchPage[];
  activePage: number;
  createdAt: string;
  updatedAt: string;
}

export interface MixedFeedViewPreferences {
  range: TimeRange;
  media: MediaFilter;
}

export interface ChannelsViewPreferences extends MixedFeedViewPreferences {
  space: string;
}

export interface ViewPreferences {
  home: MixedFeedViewPreferences;
  channels: ChannelsViewPreferences;
  updates: MixedFeedViewPreferences;
}

export type VocabMeaningStatus = 'pending' | 'ready' | 'failed';

export interface VocabItem {
  id: string;
  word: string;
  meaning: string;
  status: VocabMeaningStatus;
  addedAt: string;
  meaningUpdatedAt: string;
}

export function normalizeVocabWord(word: string): string {
  return word.trim().replace(/\s+/g, ' ');
}

export function vocabIdFromWord(word: string): string {
  return normalizeVocabWord(word).toLocaleLowerCase('en-US');
}

export interface ChannelPreferenceStore {
  channels: ChannelPreference[];
  spaces: string[];
  view: ViewPreferences;
  viewUpdatedAt: string;
  updatesChannelIds: string[];
  vocabs: VocabItem[];
  ignoredChannels: DiscoveredChannel[];
  discoverSearches: DiscoverSearchRecord[];
  activeDiscoverSearchId?: string;
  discoverDraft?: DiscoverSearchFilters;
  lastPagePath?: string;
}

export interface DailyQuotaUsage {
  date: string;
  used: number;
  updatedAt: string;
}

export interface Video {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string; // ISO
  channelId: string;
  channelTitle: string;
  channelThumbnail?: string;
  durationSec?: number;
  viewCount?: number;
  isShort?: boolean;
}

export interface VideoComment {
  id: string;
  author: string;
  text: string;
  likeCount: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface ChannelWithVideos {
  channel: Channel;
  videos: Video[];
}

export interface QuotaSummary {
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  usedTodayPercent: number;
  refreshCost: number;
  source: 'tracked' | 'estimated';
  sourceLabel: string;
  sourceDetail?: string;
  updatedAt?: string;
  channelCalls: number;
  playlistCalls: number;
  videoDetailCalls: number;
}
