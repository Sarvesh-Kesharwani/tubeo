// Core domain types. Keep minimal + extensible.

export type TimeRange = '1d' | '3d' | '7d' | '30d' | '180d' | '365d' | 'all';
export type MediaFilter = 'all' | 'videos' | 'shorts';
export type DurationFilter = 'all' | 'under5' | '5to15' | '15to30' | '30to60' | '60to120' | 'over120';
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
  duration: DurationFilter;
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

export interface YouLearnTranscriptSegment {
  index: number;
  startTime: number;
  text: string;
}

export interface NewsYouLearnVideo {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  durationSec: number;
  contentId?: string;
  importedAt: string;
  completedAt?: string;
}

export interface NewsYouLearnVideoSummary {
  date: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  thumbnail?: string;
  data: unknown;
  raw: string;
  promptHash: string;
  generatedAt: string;
}

export interface NewsClipWiseProgress {
  videoId: string;
  clipSeconds: number;
  done: number[];
  lastClipIndex: number;
  completedAt?: string;
  updatedAt: string;
}

export interface NewsYouLearnState {
  sourceUrl: string;
  importedAt: string;
  prompt: string;
  promptUpdatedAt?: string;
  videos: NewsYouLearnVideo[];
  summaries: Record<string, NewsYouLearnVideoSummary>;
  selectedVideoIds?: Record<string, string>;
  clipwiseProgress?: Record<string, NewsClipWiseProgress>;
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
  newsYouLearn?: NewsYouLearnState;
}

export interface DailyQuotaUsage {
  date: string;
  used: number;
  updatedAt: string;
  operations?: ApiUsageOperation[];
}

export type DailyQuotaUsageHistory = DailyQuotaUsage[];

export type ApiUsageKind = 'youtube' | 'deepseek';

export interface ApiUsageOperation {
  id: string;
  label: string;
  units: number;
  at: string;
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
  operations: ApiUsageOperation[];
  triggerCosts: ApiUsageTriggerCost[];
  channelCalls: number;
  playlistCalls: number;
  videoDetailCalls: number;
}

export interface ApiUsageTriggerCost {
  label: string;
  cost: string;
}

export interface ApiUsageSummary {
  kind: ApiUsageKind;
  label: string;
  date: string;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  usedTodayPercent: number;
  updatedAt?: string;
  operations: ApiUsageOperation[];
  triggerCosts: ApiUsageTriggerCost[];
}
