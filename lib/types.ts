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

export type SavedVideoKind = 'youtube' | 'instagram';

export interface SavedVideo {
  id: string;
  url: string;
  note: string;
  addedAt: string;
}

export const INSTAGRAM_SAVED_PREFIX = 'ig_';

export function getSavedVideoKind(saved: { id: string }): SavedVideoKind {
  return saved.id.startsWith(INSTAGRAM_SAVED_PREFIX) ? 'instagram' : 'youtube';
}

export interface ChannelPreferenceStore {
  channels: ChannelPreference[];
  spaces: string[];
  view: ViewPreferences;
  updatesChannelIds: string[];
  savedVideos: SavedVideo[];
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
