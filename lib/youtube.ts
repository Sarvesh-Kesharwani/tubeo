// Thin YouTube Data API v3 client. Server-only.
// Exposes: getChannels, getLatestVideosForChannel, getMixedFeed, getChannelGroupedFeed.

import 'server-only';
import { cache } from 'react';
import { hasDriveSyncHydrated } from './channels-cookie';
import { getQuotaResetTimezone, readDriveChannels, recordDriveQuotaUsage } from './drive';
import { matchesMediaFilter } from './media';
import { getRequestTime } from './render';
import { rangeToMs, withinRange } from './time';
import type {
  Channel,
  ChannelPreferenceStore,
  ChannelWithVideos,
  DiscoveredChannel,
  MediaFilter,
  QuotaSummary,
  TimeRange,
  Video,
  VideoComment,
} from './types';
import { getWhitelistedChannelIds } from './whitelist';

const API = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_DAILY_QUOTA_LIMIT = 10_000;

function key(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error('YOUTUBE_API_KEY missing');
  return k;
}

// Fetch wrapper w/ Next revalidation. 10min default; overridable.
async function yt<T>(path: string, params: Record<string, string>, revalidate = 600): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: key() }).toString();
  const res = await fetch(`${API}/${path}?${qs}`, { next: { revalidate } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube ${path} ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// --- Channel meta ---

interface YTChannelListResp {
  items: Array<{
    id: string;
    snippet: { title: string; thumbnails: { default?: { url: string }; medium?: { url: string } } };
    contentDetails: { relatedPlaylists: { uploads: string } };
  }>;
}

interface YTPlaylistItemsResp {
  items: Array<{
    contentDetails: { videoId: string; videoPublishedAt?: string };
    snippet: {
      title: string;
      publishedAt: string;
      channelId: string;
      channelTitle: string;
      thumbnails: { medium?: { url: string }; high?: { url: string }; default?: { url: string } };
    };
  }>;
  nextPageToken?: string;
}

interface YTVideoListResp {
  items: Array<{
    id: string;
    snippet?: {
      title: string;
      publishedAt: string;
      channelId: string;
      channelTitle: string;
      thumbnails: { medium?: { url: string }; high?: { url: string }; default?: { url: string } };
    };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }>;
}

interface YTCommentThreadsResp {
  items: Array<{
    id: string;
    snippet: {
      topLevelComment: {
        snippet: {
          authorDisplayName: string;
          textDisplay: string;
          likeCount: number;
        };
      };
    };
  }>;
}

interface YTSearchListResp {
  items: Array<{
    id: { kind?: string; channelId?: string };
    snippet: {
      channelId?: string;
      title?: string;
      description?: string;
      thumbnails?: { default?: { url: string }; medium?: { url: string }; high?: { url: string } };
      publishedAt?: string;
    };
  }>;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  regionCode?: string;
}

interface YTChannelStatsResp {
  items: Array<{
    id: string;
    snippet?: { country?: string };
    statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
  }>;
}

interface ChannelVideosWithQuota {
  videos: Video[];
  playlistCalls: number;
  videoDetailCalls: number;
}

export type ChannelSearchOrder = 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount';
export type ChannelSearchSafeSearch = 'moderate' | 'none' | 'strict';
export type ChannelSearchType = 'any' | 'show';

export interface ChannelSearchParams {
  q: string;
  order?: ChannelSearchOrder;
  regionCode?: string;
  relevanceLanguage?: string;
  safeSearch?: ChannelSearchSafeSearch;
  channelType?: ChannelSearchType;
  publishedAfter?: string;
  publishedBefore?: string;
  topicId?: string;
  pageToken?: string;
  ignoredIds?: string[];
  existingIds?: string[];
}

export interface ChannelSearchResult {
  channels: DiscoveredChannel[];
  nextPageToken?: string;
  prevPageToken?: string;
  totalResults?: number;
  resultsPerPage?: number;
  hiddenIgnored: number;
  hiddenSelected: number;
  quotaUnits: number;
}

export interface ChannelStatsResult {
  subscriberCount?: number;
  viewCount?: number;
  videoCount?: number;
  country?: string;
  quotaUnits: number;
}

export interface ShortFeedVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  durationSec?: number;
}

export interface ShortFeedSearchParams {
  q: string;
  publishedAfter?: string;
  publishedBefore?: string;
  maxResults?: number;
  order?: 'date' | 'viewCount' | 'relevance' | 'rating';
}

export async function searchYouTubeShorts(
  params: ShortFeedSearchParams,
): Promise<{ videos: ShortFeedVideo[]; quotaUnits: number }> {
  const q = params.q.trim();
  if (!q) return { videos: [], quotaUnits: 0 };

  const max = Math.max(1, Math.min(50, Math.floor(params.maxResults ?? 50)));
  let quotaUnits = 0;

  const search = await yt<YTSearchListResp>(
    'search',
    {
      part: 'snippet',
      type: 'video',
      videoDuration: 'short',
      q,
      maxResults: String(max),
      order: params.order ?? 'viewCount',
      safeSearch: 'moderate',
      ...(validIsoDateTime(params.publishedAfter)
        ? { publishedAfter: validIsoDateTime(params.publishedAfter)! }
        : {}),
      ...(validIsoDateTime(params.publishedBefore)
        ? { publishedBefore: validIsoDateTime(params.publishedBefore)! }
        : {}),
    },
    0,
  );
  quotaUnits += 100;

  const ids = search.items
    .map((item) => (item.id as { videoId?: string }).videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { videos: [], quotaUnits };

  const data = await yt<YTVideoListResp>(
    'videos',
    {
      part: 'snippet,statistics,contentDetails',
      id: ids.join(','),
      maxResults: String(ids.length),
    },
    600,
  );
  quotaUnits += 1;

  const orderIndex = new Map(ids.map((id, index) => [id, index]));
  const videos: ShortFeedVideo[] = data.items
    .map((item) => {
      const durationSec = parseDurationToSeconds(item.contentDetails?.duration);
      return {
        id: item.id,
        title: item.snippet?.title || item.id,
        thumbnail:
          item.snippet?.thumbnails?.high?.url ??
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          '',
        channelId: item.snippet?.channelId || '',
        channelTitle: item.snippet?.channelTitle || '',
        publishedAt: item.snippet?.publishedAt || '',
        viewCount: parseStat(item.statistics?.viewCount),
        likeCount: parseStat(item.statistics?.likeCount),
        commentCount: parseStat(item.statistics?.commentCount),
        durationSec,
      };
    })
    .filter((video) => isShortByDuration(video.durationSec))
    .sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

  return { videos, quotaUnits };
}

function parseDurationToSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return undefined;

  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 24 * 60 * 60 +
    Number(hours ?? 0) * 60 * 60 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

function isShortByDuration(durationSec: number | undefined): boolean {
  // The Data API does not expose a first-class shorts flag, so duration is our best stable signal.
  return typeof durationSec === 'number' && durationSec <= 180;
}

async function getVideoDetails(videoIds: string[]): Promise<Map<string, { durationSec?: number; viewCount?: number }>> {
  if (videoIds.length === 0) return new Map();

  const data = await yt<YTVideoListResp>(
    'videos',
    {
      part: 'contentDetails,statistics',
      id: videoIds.join(','),
      maxResults: '50',
    },
    600,
  );

  return new Map(
    data.items.map((item) => {
      const durationSec = parseDurationToSeconds(item.contentDetails?.duration);
      const parsedViews = Number(item.statistics?.viewCount);
      return [
        item.id,
        {
          durationSec,
          viewCount: Number.isFinite(parsedViews) ? parsedViews : undefined,
        },
      ];
    }),
  );
}

function parseStat(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validIsoDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function validRegionCode(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function validLanguageCode(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && /^[a-z]{2}(?:-[A-Za-z]+)?$/.test(normalized) ? normalized : undefined;
}

export async function getYouTubeChannelStats(channelId: string): Promise<ChannelStatsResult | null> {
  const id = channelId.trim();
  if (!id) return null;

  const data = await yt<YTChannelStatsResp>(
    'channels',
    {
      part: 'snippet,statistics',
      id,
      maxResults: '1',
    },
    600,
  );
  const item = data.items[0];
  if (!item) return null;

  return {
    subscriberCount: item.statistics?.hiddenSubscriberCount ? undefined : parseStat(item.statistics?.subscriberCount),
    viewCount: parseStat(item.statistics?.viewCount),
    videoCount: parseStat(item.statistics?.videoCount),
    country: item.snippet?.country,
    quotaUnits: 1,
  };
}

export async function getYouTubeChannelStatsMany(
  channelIds: string[],
): Promise<{ stats: Map<string, ChannelStatsResult>; quotaUnits: number }> {
  const ids = [...new Set(channelIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { stats: new Map(), quotaUnits: 0 };

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  const stats = new Map<string, ChannelStatsResult>();
  let quotaUnits = 0;

  for (const chunk of chunks) {
    const data = await yt<YTChannelStatsResp>(
      'channels',
      {
        part: 'snippet,statistics',
        id: chunk.join(','),
        maxResults: '50',
      },
      600,
    );
    quotaUnits += 1;
    for (const item of data.items) {
      stats.set(item.id, {
        subscriberCount: item.statistics?.hiddenSubscriberCount ? undefined : parseStat(item.statistics?.subscriberCount),
        viewCount: parseStat(item.statistics?.viewCount),
        videoCount: parseStat(item.statistics?.videoCount),
        country: item.snippet?.country,
        quotaUnits: 1,
      });
    }
  }

  return { stats, quotaUnits };
}

export interface DiscoveredTopVideo {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  durationSec?: number;
}

export async function getTopVideosForChannel(
  channelId: string,
  limit = 3,
): Promise<{ videos: DiscoveredTopVideo[]; quotaUnits: number }> {
  const id = channelId.trim();
  if (!id) return { videos: [], quotaUnits: 0 };

  let quotaUnits = 0;

  const search = await yt<YTSearchListResp>(
    'search',
    {
      part: 'snippet',
      type: 'video',
      channelId: id,
      order: 'viewCount',
      maxResults: '10',
    },
    600,
  );
  quotaUnits += 100;

  const videoIds = search.items
    .map((item) => (item.id as { videoId?: string }).videoId)
    .filter((vid): vid is string => Boolean(vid));
  if (videoIds.length === 0) return { videos: [], quotaUnits };

  const data = await yt<YTVideoListResp>(
    'videos',
    {
      part: 'snippet,statistics,contentDetails',
      id: videoIds.join(','),
      maxResults: '50',
    },
    600,
  );
  quotaUnits += 1;

  const videos: DiscoveredTopVideo[] = data.items.map((item) => ({
    id: item.id,
    title: item.snippet?.title || item.id,
    thumbnail:
      item.snippet?.thumbnails?.medium?.url ??
      item.snippet?.thumbnails?.high?.url ??
      item.snippet?.thumbnails?.default?.url ??
      '',
    publishedAt: item.snippet?.publishedAt || '',
    viewCount: parseStat(item.statistics?.viewCount),
    likeCount: parseStat(item.statistics?.likeCount),
    commentCount: parseStat(item.statistics?.commentCount),
    durationSec: parseDurationToSeconds(item.contentDetails?.duration),
  }));

  videos.sort((a, b) => {
    const va = a.viewCount ?? -1;
    const vb = b.viewCount ?? -1;
    if (va !== vb) return vb - va;
    const la = a.likeCount ?? -1;
    const lb = b.likeCount ?? -1;
    if (la !== lb) return lb - la;
    const ca = a.commentCount ?? -1;
    const cb = b.commentCount ?? -1;
    return cb - ca;
  });

  return { videos: videos.slice(0, Math.max(1, limit)), quotaUnits };
}

export function sortDiscoveredChannelsByStats(channels: DiscoveredChannel[]): DiscoveredChannel[] {
  return [...channels].sort((a, b) => {
    const subA = typeof a.subscriberCount === 'number' ? a.subscriberCount : -1;
    const subB = typeof b.subscriberCount === 'number' ? b.subscriberCount : -1;
    if (subA !== subB) return subB - subA;
    const viewA = typeof a.viewCount === 'number' ? a.viewCount : -1;
    const viewB = typeof b.viewCount === 'number' ? b.viewCount : -1;
    if (viewA !== viewB) return viewB - viewA;
    const vidA = typeof a.videoCount === 'number' ? a.videoCount : -1;
    const vidB = typeof b.videoCount === 'number' ? b.videoCount : -1;
    return vidB - vidA;
  });
}

export async function searchYouTubeChannels(params: ChannelSearchParams): Promise<ChannelSearchResult> {
  const q = params.q.trim();
  if (!q) {
    return { channels: [], hiddenIgnored: 0, hiddenSelected: 0, quotaUnits: 0 };
  }

  const ignoredIds = new Set(params.ignoredIds ?? []);
  const existingIds = new Set(params.existingIds ?? []);
  const out = new Map<string, DiscoveredChannel>();
  let pageToken = params.pageToken?.trim() || undefined;
  let nextPageToken: string | undefined;
  let prevPageToken: string | undefined;
  let totalResults: number | undefined;
  let resultsPerPage: number | undefined;
  let hiddenIgnored = 0;
  let hiddenSelected = 0;
  let quotaUnits = 0;

  for (let page = 0; page < 5 && out.size < 50; page++) {
    const data = await yt<YTSearchListResp>(
      'search',
      {
        part: 'snippet',
        type: 'channel',
        q,
        maxResults: '50',
        order: params.order ?? 'relevance',
        safeSearch: params.safeSearch ?? 'moderate',
        ...(params.channelType && params.channelType !== 'any' ? { channelType: params.channelType } : {}),
        ...(validRegionCode(params.regionCode) ? { regionCode: validRegionCode(params.regionCode)! } : {}),
        ...(validLanguageCode(params.relevanceLanguage) ? { relevanceLanguage: validLanguageCode(params.relevanceLanguage)! } : {}),
        ...(validIsoDateTime(params.publishedAfter) ? { publishedAfter: validIsoDateTime(params.publishedAfter)! } : {}),
        ...(validIsoDateTime(params.publishedBefore) ? { publishedBefore: validIsoDateTime(params.publishedBefore)! } : {}),
        ...(params.topicId?.trim() ? { topicId: params.topicId.trim() } : {}),
        ...(pageToken ? { pageToken } : {}),
      },
      0,
    );
    quotaUnits += 100;
    nextPageToken = data.nextPageToken;
    prevPageToken = data.prevPageToken;
    totalResults = data.pageInfo?.totalResults ?? totalResults;
    resultsPerPage = data.pageInfo?.resultsPerPage ?? resultsPerPage;

    const found = data.items
      .map((item) => {
        const id = item.id.channelId || item.snippet.channelId || '';
        return {
          id,
          title: item.snippet.title || id,
          thumbnail:
            item.snippet.thumbnails?.high?.url ??
            item.snippet.thumbnails?.medium?.url ??
            item.snippet.thumbnails?.default?.url ??
            '',
          description: item.snippet.description || '',
        } satisfies DiscoveredChannel;
      })
      .filter((channel) => channel.id);

    for (const channel of found) {
      if (ignoredIds.has(channel.id)) {
        hiddenIgnored += 1;
        continue;
      }
      if (existingIds.has(channel.id)) {
        hiddenSelected += 1;
        continue;
      }
      if (out.has(channel.id)) continue;
      out.set(channel.id, channel);
      if (out.size >= 50) break;
    }

    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }

  const channels = [...out.values()].slice(0, 50);
  const statsResult = await getYouTubeChannelStatsMany(channels.map((channel) => channel.id));
  quotaUnits += statsResult.quotaUnits;

  const enriched = channels.map((channel) => {
    const stats = statsResult.stats.get(channel.id);
    return stats
      ? {
          ...channel,
          subscriberCount: stats.subscriberCount,
          viewCount: stats.viewCount,
          videoCount: stats.videoCount,
          country: stats.country ?? channel.country,
        }
      : channel;
  });

  return {
    channels: sortDiscoveredChannelsByStats(enriched),
    nextPageToken,
    prevPageToken,
    totalResults,
    resultsPerPage,
    hiddenIgnored,
    hiddenSelected,
    quotaUnits,
  };
}

function buildQuotaSummary(
  dailyLimit: number,
  usedToday: number,
  source: QuotaSummary['source'],
  sourceLabel: string,
  sourceDetail: string | undefined,
  channelCalls: number,
  playlistCalls: number,
  videoDetailCalls: number,
  updatedAt?: string,
): QuotaSummary {
  const refreshCost = channelCalls + playlistCalls + videoDetailCalls;
  const remainingToday = Math.max(0, dailyLimit - usedToday);

  return {
    dailyLimit,
    usedToday,
    remainingToday,
    usedTodayPercent: dailyLimit > 0 ? (usedToday / dailyLimit) * 100 : 0,
    refreshCost,
    source,
    sourceLabel,
    sourceDetail,
    updatedAt,
    channelCalls,
    playlistCalls,
    videoDetailCalls,
  };
}

export async function getChannels(ids?: string[]): Promise<Channel[]> {
  if (!ids) ids = await getWhitelistedChannelIds();
  ids = ids.filter((id) => /^UC[\w-]{22}$/.test(id));
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  const all: Channel[] = [];
  for (const c of chunks) {
    const data = await yt<YTChannelListResp>(
      'channels',
      {
        part: 'snippet,contentDetails',
        id: c.join(','),
        maxResults: '50',
      },
      3600,
    );
    for (const it of data.items) {
      all.push({
        id: it.id,
        title: it.snippet.title,
        thumbnail: it.snippet.thumbnails.medium?.url ?? it.snippet.thumbnails.default?.url ?? '',
        uploadsPlaylistId: it.contentDetails.relatedPlaylists.uploads,
      });
    }
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  all.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return all;
}

export function getEstimatedFeedQuotaSummary(
  channelCount: number,
  estimatedPlaylistPagesPerChannel = 2,
): QuotaSummary {
  const channelCalls = channelCount === 0 ? 0 : Math.ceil(channelCount / 50);
  const playlistCalls = channelCount * estimatedPlaylistPagesPerChannel;
  const videoDetailCalls = channelCount * estimatedPlaylistPagesPerChannel;
  return buildQuotaSummary(
    YOUTUBE_DAILY_QUOTA_LIMIT,
    0,
    'estimated',
    'Tubeo request estimate',
    `Tubeo tracks usage in Drive app data and resets it each midnight (${getQuotaResetTimezone()}). This is the expected cost of one feed refresh.`,
    channelCalls,
    playlistCalls,
    videoDetailCalls,
  );
}

export async function getYouTubeQuotaSummary(
  channelCount: number,
  accessToken?: string,
  estimatedPlaylistPagesPerChannel = 2,
): Promise<QuotaSummary> {
  const estimated = getEstimatedFeedQuotaSummary(channelCount, estimatedPlaylistPagesPerChannel);

  try {
    if (!accessToken) return estimated;

    const driveData = await readDriveChannels(accessToken);
    if (!driveData) {
      return {
        ...estimated,
        sourceDetail: `Tubeo starts persistent quota tracking after the first signed-in request syncs to Drive app data. Resets each midnight (${getQuotaResetTimezone()}).`,
      };
    }

    return buildQuotaSummary(
      YOUTUBE_DAILY_QUOTA_LIMIT,
      driveData.quota.used,
      'tracked',
      'Tubeo daily tracker',
      `Counts each YouTube API call Tubeo records in Drive app data and resets each midnight (${getQuotaResetTimezone()}).`,
      estimated.channelCalls,
      estimated.playlistCalls,
      estimated.videoDetailCalls,
      driveData.quota.updatedAt || driveData.updatedAt,
    );
  } catch (error) {
    return {
      ...estimated,
      sourceDetail: `Fell back to estimate: ${(error as Error).message}`,
    };
  }
}

export async function trackYouTubeQuotaUsage(
  accessToken: string | undefined,
  quota: Pick<QuotaSummary, 'refreshCost'> | number,
  fallbackStore?: ChannelPreferenceStore,
): Promise<void> {
  if (!accessToken) return;
  if (!(await hasDriveSyncHydrated())) return;

  const units = typeof quota === 'number' ? quota : quota.refreshCost;
  if (units <= 0) return;

  await recordDriveQuotaUsage(accessToken, units, fallbackStore);
}

async function getLatestVideosForChannelWithQuota(
  channel: Channel,
  range: TimeRange,
  mediaFilter: MediaFilter,
  max = 20,
  now = getRequestTime(),
): Promise<ChannelVideosWithQuota> {
  const isAllTime = range === 'all';
  const cutoff = isAllTime ? Number.NEGATIVE_INFINITY : now - rangeToMs(range);
  const out: Video[] = [];
  let pageToken: string | undefined;
  let playlistCalls = 0;
  let videoDetailCalls = 0;
  const maxPages = isAllTime ? 10 : 3;

  for (let page = 0; page < maxPages; page++) {
    playlistCalls += 1;
    const data = await yt<YTPlaylistItemsResp>(
      'playlistItems',
      {
        part: 'snippet,contentDetails',
        playlistId: channel.uploadsPlaylistId,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      },
      600,
    );

    const videoIds = data.items.map((item) => item.contentDetails.videoId).filter(Boolean);
    const detailsById = await getVideoDetails(videoIds);
    videoDetailCalls += videoIds.length > 0 ? 1 : 0;

    let stop = false;
    for (const it of data.items) {
      const publishedAt = it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt;
      if (!isAllTime && Date.parse(publishedAt) < cutoff) {
        stop = true;
        break;
      }

      const details = detailsById.get(it.contentDetails.videoId);
      const video: Video = {
        id: it.contentDetails.videoId,
        title: it.snippet.title,
        thumbnail:
          it.snippet.thumbnails.high?.url ??
          it.snippet.thumbnails.medium?.url ??
          it.snippet.thumbnails.default?.url ??
          '',
        publishedAt,
        channelId: it.snippet.channelId,
        channelTitle: it.snippet.channelTitle,
        channelThumbnail: channel.thumbnail,
        durationSec: details?.durationSec,
        viewCount: details?.viewCount,
        isShort: isShortByDuration(details?.durationSec),
      };

      if (!matchesMediaFilter(video, mediaFilter)) continue;

      out.push(video);
      if (out.length >= max) {
        stop = true;
        break;
      }
    }

    if (stop || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return {
    videos: out.filter((video) => withinRange(video.publishedAt, range, now)),
    playlistCalls,
    videoDetailCalls,
  };
}

export async function getLatestVideosForChannel(
  channel: Channel,
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  max = 20,
  now = getRequestTime(),
): Promise<Video[]> {
  return (await getLatestVideosForChannelWithQuota(channel, range, mediaFilter, max, now)).videos;
}

export async function getVideosByIds(videoIds: string[]): Promise<Video[]> {
  const ids = [...new Set(videoIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const data = await yt<YTVideoListResp>(
    'videos',
    {
      part: 'snippet,contentDetails,statistics',
      id: ids.join(','),
      maxResults: '50',
    },
    600,
  );

  const videos = data.items.map((item) => {
    const durationSec = parseDurationToSeconds(item.contentDetails?.duration);
    const parsedViews = Number(item.statistics?.viewCount);
    return {
      id: item.id,
      title: item.snippet?.title ?? item.id,
      thumbnail:
        item.snippet?.thumbnails.high?.url ??
        item.snippet?.thumbnails.medium?.url ??
        item.snippet?.thumbnails.default?.url ??
        '',
      publishedAt: item.snippet?.publishedAt ?? new Date(0).toISOString(),
      channelId: item.snippet?.channelId ?? '',
      channelTitle: item.snippet?.channelTitle ?? 'YouTube',
      durationSec,
      viewCount: Number.isFinite(parsedViews) ? parsedViews : undefined,
      isShort: isShortByDuration(durationSec),
    } satisfies Video;
  });

  const order = new Map(ids.map((id, index) => [id, index]));
  return videos.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function classifyComment(text: string): VideoComment['sentiment'] {
  const value = text.toLowerCase();
  const positive = ['good', 'great', 'love', 'best', 'helpful', 'amazing', 'nice', 'thanks'];
  const negative = ['bad', 'worst', 'hate', 'fake', 'wrong', 'boring', 'terrible', 'useless'];
  if (positive.some((word) => value.includes(word))) return 'positive';
  if (negative.some((word) => value.includes(word))) return 'negative';
  return 'neutral';
}

export async function getVideoComments(videoId: string): Promise<{
  top: VideoComment[];
  positive: VideoComment[];
  negative: VideoComment[];
}> {
  const data = await yt<YTCommentThreadsResp>(
    'commentThreads',
    {
      part: 'snippet',
      videoId,
      order: 'relevance',
      maxResults: '50',
      textFormat: 'plainText',
    },
    600,
  );

  const comments = data.items.map((item) => {
    const snippet = item.snippet.topLevelComment.snippet;
    const text = snippet.textDisplay.replace(/<[^>]*>/g, '').trim();
    return {
      id: item.id,
      author: snippet.authorDisplayName,
      text,
      likeCount: snippet.likeCount,
      sentiment: classifyComment(text),
    } satisfies VideoComment;
  });

  const byLikes = [...comments].sort((a, b) => b.likeCount - a.likeCount);
  return {
    top: byLikes.slice(0, 5),
    positive: byLikes.filter((comment) => comment.sentiment === 'positive').slice(0, 5),
    negative: byLikes.filter((comment) => comment.sentiment === 'negative').slice(0, 5),
  };
}

export const getChannelGroupedFeed = cache(async function getChannelGroupedFeed(
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  perChannel = 6,
  now = getRequestTime(),
): Promise<ChannelWithVideos[]> {
  return (await getChannelGroupedFeedWithQuota(range, mediaFilter, perChannel, now)).groups;
});

export const getChannelGroupedFeedWithQuota = cache(async function getChannelGroupedFeedWithQuota(
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  perChannel = 6,
  now = getRequestTime(),
): Promise<{ groups: ChannelWithVideos[]; quota: QuotaSummary }> {
  const channels = await getChannels();
  const results = await Promise.all(
    channels.map(async (channel) => {
      const { videos, playlistCalls, videoDetailCalls } = await getLatestVideosForChannelWithQuota(
        channel,
        range,
        mediaFilter,
        perChannel,
        now,
      );
      return { channel, videos, playlistCalls, videoDetailCalls };
    }),
  );
  const channelCalls = channels.length === 0 ? 0 : Math.ceil(channels.length / 50);
  const playlistCalls = results.reduce((sum, result) => sum + result.playlistCalls, 0);
  const videoDetailCalls = results.reduce((sum, result) => sum + result.videoDetailCalls, 0);

  return {
    groups: results.map(({ channel, videos }) => ({ channel, videos })),
    quota: buildQuotaSummary(
      YOUTUBE_DAILY_QUOTA_LIMIT,
      0,
      'estimated',
      'Tubeo request estimate',
      'This request cost will be added to today\'s tracked total after the page finishes loading.',
      channelCalls,
      playlistCalls,
      videoDetailCalls,
    ),
  };
});

export const getMixedFeed = cache(async function getMixedFeed(
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  perChannel = 10,
  now = getRequestTime(),
): Promise<Video[]> {
  return (await getMixedFeedWithQuota(range, mediaFilter, perChannel, now)).videos;
});

export const getMixedFeedWithQuota = cache(async function getMixedFeedWithQuota(
  range: TimeRange,
  mediaFilter: MediaFilter = 'all',
  perChannel = 10,
  now = getRequestTime(),
): Promise<{ videos: Video[]; quota: QuotaSummary }> {
  const channels = await getChannels();
  const channelCalls = channels.length === 0 ? 0 : Math.ceil(channels.length / 50);
  const results = await Promise.all(
    channels.map(async (channel) => {
      const { videos, playlistCalls, videoDetailCalls } = await getLatestVideosForChannelWithQuota(
        channel,
        range,
        mediaFilter,
        perChannel,
        now,
      );
      return { videos, playlistCalls, videoDetailCalls };
    }),
  );

  const videos = results.flatMap((result) => result.videos);
  videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const playlistCalls = results.reduce((sum, result) => sum + result.playlistCalls, 0);
  const videoDetailCalls = results.reduce((sum, result) => sum + result.videoDetailCalls, 0);

  return {
    videos,
    quota: buildQuotaSummary(
      YOUTUBE_DAILY_QUOTA_LIMIT,
      0,
      'estimated',
      'Tubeo request estimate',
      'This request cost will be added to today\'s tracked total after the page finishes loading.',
      channelCalls,
      playlistCalls,
      videoDetailCalls,
    ),
  };
});
