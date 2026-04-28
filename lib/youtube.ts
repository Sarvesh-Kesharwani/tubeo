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
    statistics?: { viewCount?: string };
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

interface ChannelVideosWithQuota {
  videos: Video[];
  playlistCalls: number;
  videoDetailCalls: number;
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
