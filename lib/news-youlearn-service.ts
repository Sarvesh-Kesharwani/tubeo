import 'server-only';

import { createHash } from 'crypto';
import type { Session } from 'next-auth';
import { emptyNewsYouLearnState } from './drive';
import { summarizeYouLearnNewsTranscript, type YouLearnNewsTranscriptResult } from './deepseek';
import {
  DEFAULT_CHANNEL_SPACE,
  type ChannelPreferenceStore,
  type NewsClipWiseProgress,
  type NewsYouLearnState,
  type NewsYouLearnVideoSummary,
} from './types';
import { DEFAULT_VIEW_PREFERENCES } from './view-preferences';
import { readUserSyncState, writeUserSyncState } from './sync-store';
import {
  fetchYouLearnSpaceVideos,
  fetchYouLearnTranscript,
  pickDailyYouLearnVideo,
  transcriptToText,
} from './youlearn-news';

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function summaryKey(date: string, videoId: string): string {
  return `${date}:${videoId}`;
}

function emptyStore(): ChannelPreferenceStore {
  return {
    channels: [],
    spaces: [DEFAULT_CHANNEL_SPACE],
    view: DEFAULT_VIEW_PREFERENCES,
    viewUpdatedAt: new Date(0).toISOString(),
    updatesChannelIds: [],
    vocabs: [],
    ignoredChannels: [],
    discoverSearches: [],
    newsYouLearn: emptyNewsYouLearnState(),
  };
}

function mergeVideos(
  existing: NewsYouLearnState['videos'],
  imported: NewsYouLearnState['videos'],
): NewsYouLearnState['videos'] {
  const seen = new Set<string>();
  const merged: NewsYouLearnState['videos'] = [];
  for (const video of [...existing, ...imported]) {
    const key = video.contentId || video.url || video.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(video);
  }
  return merged.slice(0, 500);
}

function pruneSummaries(
  summaries: NewsYouLearnState['summaries'],
  videoIds: Set<string>,
): NewsYouLearnState['summaries'] {
  return Object.fromEntries(Object.entries(summaries).filter(([, summary]) => videoIds.has(summary.videoId)));
}

function pruneSelectedVideoIds(
  selectedVideoIds: NewsYouLearnState['selectedVideoIds'],
  videoIds: Set<string>,
): NewsYouLearnState['selectedVideoIds'] {
  return Object.fromEntries(
    Object.entries(selectedVideoIds ?? {}).filter(([, videoId]) => videoIds.has(videoId)),
  );
}

function pruneClipWiseProgress(
  clipwiseProgress: NewsYouLearnState['clipwiseProgress'],
  videoIds: Set<string>,
): NewsYouLearnState['clipwiseProgress'] {
  return Object.fromEntries(
    Object.entries(clipwiseProgress ?? {}).filter(([, progress]) => videoIds.has(progress.videoId)),
  );
}

function syncClipWiseProgressForVideos(
  clipwiseProgress: NewsYouLearnState['clipwiseProgress'],
  videos: NewsYouLearnState['videos'],
): NewsYouLearnState['clipwiseProgress'] {
  const now = new Date().toISOString();
  const videoIds = new Set(videos.map((video) => video.id));
  const next = pruneClipWiseProgress(clipwiseProgress, videoIds) ?? {};
  for (const video of videos) {
    const key = `${video.id}:120`;
    next[key] = next[key] ?? {
      videoId: video.id,
      clipSeconds: 120,
      done: [],
      lastClipIndex: 0,
      updatedAt: now,
    };
  }
  return next;
}

function storeFromState(state: Awaited<ReturnType<typeof readUserSyncState>>['state']): ChannelPreferenceStore {
  if (!state) return emptyStore();
  return {
    channels: state.channels,
    spaces: state.spaces,
    view: state.view,
    viewUpdatedAt: state.viewUpdatedAt,
    updatesChannelIds: state.updatesChannelIds,
    vocabs: state.vocabs,
    ignoredChannels: state.ignoredChannels,
    discoverSearches: state.discoverSearches,
    activeDiscoverSearchId: state.activeDiscoverSearchId,
    discoverDraft: state.discoverDraft,
    lastPagePath: state.lastPagePath,
    newsYouLearn: state.newsYouLearn ?? emptyNewsYouLearnState(),
  };
}

export async function readNewsYouLearnState(session: Session | null | undefined): Promise<NewsYouLearnState> {
  const { state } = await readUserSyncState(session);
  const newsYouLearn = state?.newsYouLearn ?? emptyNewsYouLearnState();
  if (newsYouLearn.videos.length === 0) return newsYouLearn;

  const syncedProgress = syncClipWiseProgressForVideos(newsYouLearn.clipwiseProgress, newsYouLearn.videos);
  const currentKeys = Object.keys(newsYouLearn.clipwiseProgress ?? {}).sort().join('|');
  const syncedKeys = Object.keys(syncedProgress ?? {}).sort().join('|');
  if (syncedKeys === currentKeys) {
    return newsYouLearn;
  }

  return writeNewsYouLearnState(session, {
    ...newsYouLearn,
    clipwiseProgress: syncedProgress,
  });
}

async function writeNewsYouLearnState(
  session: Session | null | undefined,
  next: NewsYouLearnState,
): Promise<NewsYouLearnState> {
  const { state } = await readUserSyncState(session);
  const base = storeFromState(state);
  const result = await writeUserSyncState(session, {
    ...base,
    newsYouLearn: next,
    quota: state?.quota,
    deepseekQuota: state?.deepseekQuota,
    quotaHistory: state?.quotaHistory,
    deepseekQuotaHistory: state?.deepseekQuotaHistory,
  });
  return result.state?.newsYouLearn ?? next;
}

export async function saveNewsYouLearnPrompt(
  session: Session | null | undefined,
  prompt: string,
): Promise<NewsYouLearnState> {
  const state = await readNewsYouLearnState(session);
  const now = new Date().toISOString();
  return writeNewsYouLearnState(session, {
    ...state,
    prompt: prompt.slice(0, 8000),
    promptUpdatedAt: now,
  });
}

export async function importNewsYouLearnSpace(
  session: Session | null | undefined,
  sourceUrl: string,
): Promise<NewsYouLearnState> {
  const videos = await fetchYouLearnSpaceVideos(sourceUrl);
  const state = await readNewsYouLearnState(session);
  const mergedVideos = mergeVideos(state.videos, videos);
  return writeNewsYouLearnState(session, {
    ...state,
    sourceUrl: sourceUrl.trim(),
    importedAt: new Date().toISOString(),
    videos: mergedVideos,
    summaries: pruneSummaries(state.summaries, new Set(mergedVideos.map((video) => video.id))),
    selectedVideoIds: pruneSelectedVideoIds(state.selectedVideoIds, new Set(mergedVideos.map((video) => video.id))),
    clipwiseProgress: syncClipWiseProgressForVideos(state.clipwiseProgress, mergedVideos),
  });
}

export async function removeNewsYouLearnVideo(
  session: Session | null | undefined,
  videoId: string,
): Promise<NewsYouLearnState> {
  const state = await readNewsYouLearnState(session);
  const videos = state.videos.filter((video) => video.id !== videoId);
  return writeNewsYouLearnState(session, {
    ...state,
    videos,
    summaries: pruneSummaries(state.summaries, new Set(videos.map((video) => video.id))),
    selectedVideoIds: pruneSelectedVideoIds(state.selectedVideoIds, new Set(videos.map((video) => video.id))),
    clipwiseProgress: pruneClipWiseProgress(state.clipwiseProgress, new Set(videos.map((video) => video.id))),
  });
}

export async function markNewsYouLearnVideoCompleted(
  session: Session | null | undefined,
  videoId: string,
): Promise<NewsYouLearnState> {
  const state = await readNewsYouLearnState(session);
  const completedAt = new Date().toISOString();
  const videos = state.videos.map((video) =>
    video.id === videoId
      ? {
          ...video,
          completedAt,
        }
      : video,
  );
  return writeNewsYouLearnState(session, {
    ...state,
    videos,
  });
}

export async function clearNewsYouLearnVideos(
  session: Session | null | undefined,
): Promise<NewsYouLearnState> {
  const state = await readNewsYouLearnState(session);
  return writeNewsYouLearnState(session, {
    ...state,
    videos: [],
    summaries: {},
    selectedVideoIds: {},
    clipwiseProgress: {},
  });
}

function normalizeClipDone(done: unknown): number[] {
  return [
    ...new Set(
      (Array.isArray(done) ? done : [])
        .filter((index) => Number.isInteger(index) && index >= 0)
        .map((index) => Math.round(index)),
    ),
  ].sort((a, b) => a - b).slice(0, 10000);
}

export async function saveNewsYouLearnClipWiseProgress(
  session: Session | null | undefined,
  input: {
    videoId: string;
    clipSeconds: number;
    done: number[];
    lastClipIndex: number;
    completedAt?: string;
  },
): Promise<{ state: NewsYouLearnState; progress: NewsClipWiseProgress }> {
  const state = await readNewsYouLearnState(session);
  const videoId = input.videoId.trim();
  const video = state.videos.find((item) => item.id === videoId);
  if (!video) throw new Error('Choose an imported YouLearn video.');

  const clipSeconds = Number.isFinite(input.clipSeconds) && input.clipSeconds > 0
    ? Math.min(3600, Math.round(input.clipSeconds))
    : 120;
  const totalClips = Math.max(1, Math.ceil(Math.max(video.durationSec || clipSeconds, clipSeconds) / clipSeconds));
  const done = normalizeClipDone(input.done).filter((index) => index < totalClips);
  const lastClipIndex = Number.isFinite(input.lastClipIndex)
    ? Math.min(Math.max(Math.round(input.lastClipIndex), 0), totalClips - 1)
    : 0;
  const key = `${videoId}:${clipSeconds}`;
  const previous = state.clipwiseProgress?.[key];
  const completedAt =
    previous?.completedAt ||
    (typeof input.completedAt === 'string' && input.completedAt.trim() ? input.completedAt : undefined) ||
    (done.length >= totalClips ? new Date().toISOString() : undefined);
  const progress: NewsClipWiseProgress = {
    videoId,
    clipSeconds,
    done,
    lastClipIndex,
    completedAt,
    updatedAt: new Date().toISOString(),
  };
  const videos = completedAt
    ? state.videos.map((item) => (item.id === videoId ? { ...item, completedAt: item.completedAt || completedAt } : item))
    : state.videos;
  const next = await writeNewsYouLearnState(session, {
    ...state,
    videos,
    clipwiseProgress: {
      ...(state.clipwiseProgress ?? {}),
      [key]: progress,
    },
  });

  return { state: next, progress: next.clipwiseProgress?.[key] ?? progress };
}

export async function processDailyNewsYouLearnVideo(
  session: Session | null | undefined,
  date: string,
  options: { force?: boolean; videoId?: string } = {},
): Promise<{ state: NewsYouLearnState; summary: NewsYouLearnVideoSummary }> {
  const state = await readNewsYouLearnState(session);
  const requestedVideoId = options.videoId?.trim() || state.selectedVideoIds?.[date] || '';
  const dailyVideo = pickDailyYouLearnVideo(state.videos, date);
  const video = state.videos.find((item) => item.id === requestedVideoId) ?? dailyVideo;
  if (!video) throw new Error('Import a YouLearn space before processing daily video.');

  const promptH = promptHash(state.prompt);
  const key = summaryKey(date, video.id);
  const cached = state.summaries[key] ?? (state.summaries[date]?.videoId === video.id ? state.summaries[date] : null);
  if (!options.force && cached?.videoId === video.id && cached.promptHash === promptH) {
    if (state.selectedVideoIds?.[date] === video.id) return { state, summary: cached };
    const next = await writeNewsYouLearnState(session, {
      ...state,
      selectedVideoIds: {
        ...(state.selectedVideoIds ?? {}),
        [date]: video.id,
      },
    });
    return { state: next, summary: cached };
  }
  if (!video.contentId) throw new Error('This YouLearn video has no content ID, so Tubeo cannot fetch its transcript.');

  const transcript = transcriptToText(await fetchYouLearnTranscript(video.contentId));
  if (transcript.length < 50) throw new Error('YouLearn returned no usable transcript for this video.');

  let result: YouLearnNewsTranscriptResult;
  result = await summarizeYouLearnNewsTranscript({
    date,
    videoTitle: video.title,
    videoUrl: video.url,
    transcript,
    userPrompt: state.prompt,
  });

  const summary: NewsYouLearnVideoSummary = {
    date,
    videoId: video.id,
    videoTitle: video.title,
    videoUrl: video.url,
    thumbnail: video.thumbnail,
    data: result.data,
    raw: result.raw,
    promptHash: promptH,
    generatedAt: new Date().toISOString(),
  };

  const next = await writeNewsYouLearnState(session, {
    ...state,
    selectedVideoIds: {
      ...(state.selectedVideoIds ?? {}),
      [date]: video.id,
    },
    summaries: {
      ...state.summaries,
      [key]: summary,
    },
  });
  return { state: next, summary };
}
