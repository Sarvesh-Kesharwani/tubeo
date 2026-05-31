import 'server-only';

import { createHash } from 'crypto';
import type { Session } from 'next-auth';
import { emptyNewsYouLearnState } from './drive';
import { summarizeYouLearnNewsTranscript, type YouLearnNewsTranscriptResult } from './deepseek';
import {
  DEFAULT_CHANNEL_SPACE,
  type ChannelPreferenceStore,
  type NewsClipWiseProgress,
  type NewsYouLearnNoteKind,
  type NewsYouLearnState,
  type NewsYouLearnVideo,
  type NewsYouLearnVideoSummary,
} from './types';
import { DEFAULT_VIEW_PREFERENCES } from './view-preferences';
import { readUserSyncState, writeUserSyncState } from './sync-store';
import {
  clearDailyUpscClipWiseRecords,
  deleteDailyUpscClipWiseRecord,
  isSupabaseDailyUpscClipWiseConfigured,
  readDailyUpscClipWiseRecords,
  upsertDailyUpscClipWiseRecord,
  type DailyUpscClipWiseCategory,
} from './supabase-daily-upsc-clipwise';
import { getTubeoUserIdentity } from './supabase-sync';
import {
  fetchYouLearnSpaceVideos,
  fetchYouLearnTranscript,
  pickDailyYouLearnVideo,
  transcriptToText,
} from './youlearn-news';
import { getVideosByIds, getVideosByPlaylistId } from './youtube';

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

const DEFAULT_ANALOGY_PROMPT =
  'Convert this YouLearn transcript into strict JSON for analogy-based UPSC notes. Shape: {"title":"...","core_analogy":"...","analogy_map":[{"source":"...","target":"...","explanation":"..."}],"key_points":["..."],"exam_takeaways":["..."],"revision_notes":["..."]}. Use Hinglish. Make abstract ideas simple through real-life analogies. Return JSON only.';

const DEFAULT_LAYERED_PROMPT =
  'Convert this YouLearn transcript into strict JSON for layered UPSC notes. Shape: {"layer0":{"goal":"...","roadmap":["..."]},"layer1":{"terms":[{"term":"...","definition":"..."}],"events":[{"event":"...","description":"..."}]},"layer2":{"concepts":[{"concept":"...","explanation":"..."}]},"layer3":{"geopolitical_landscape":["..."]},"layer4":{"stakeholders":["..."]},"layer5":{"timeline":["..."]},"layer6":{"outcomes":["..."]},"layer7":{"connections":["..."]}}. Use Hinglish. Return JSON only.';

function summaryKey(date: string, videoId: string, noteKind: NewsYouLearnNoteKind = 'layered'): string {
  return `${noteKind}:${date}:${videoId}`;
}

function promptForKind(state: NewsYouLearnState, noteKind: NewsYouLearnNoteKind): string {
  if (noteKind === 'analogy') return state.analogyPrompt?.trim() || DEFAULT_ANALOGY_PROMPT;
  return state.layeredPrompt?.trim() || state.prompt.trim() || DEFAULT_LAYERED_PROMPT;
}

function bestSummaryForVideo(state: NewsYouLearnState, videoId: string): NewsYouLearnVideoSummary | null {
  return (
    Object.values(state.summaries)
      .filter((summary) => summary.videoId === videoId)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] ?? null
  );
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

function normalizeFallbackVideo(value: unknown): NewsYouLearnVideo | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<NewsYouLearnVideo>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!id || !url) return null;
  return {
    id,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : 'YouLearn video',
    url,
    thumbnail: typeof item.thumbnail === 'string' && item.thumbnail.trim() ? item.thumbnail.trim() : undefined,
    durationSec:
      typeof item.durationSec === 'number' && Number.isFinite(item.durationSec) && item.durationSec > 0
        ? Math.round(item.durationSec)
        : 0,
    contentId: typeof item.contentId === 'string' && item.contentId.trim() ? item.contentId.trim() : undefined,
    importedAt:
      typeof item.importedAt === 'string' && item.importedAt.trim()
        ? item.importedAt
        : new Date().toISOString(),
    completedAt:
      typeof item.completedAt === 'string' && item.completedAt.trim()
        ? item.completedAt
        : undefined,
  };
}

function normalizeFallbackVideos(value: unknown): NewsYouLearnState['videos'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const videos: NewsYouLearnState['videos'] = [];
  for (const raw of value) {
    const video = normalizeFallbackVideo(raw);
    if (!video || seen.has(video.id)) continue;
    seen.add(video.id);
    videos.push(video);
  }
  return videos.slice(0, 500);
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

type NewsVideoTarget = 'youlearn' | 'clipwise';

type YouTubeSource =
  | { type: 'video'; id: string }
  | { type: 'playlist'; id: string };

function parseYouTubeSource(rawUrl: string): YouTubeSource | null {
  const input = rawUrl.trim();
  if (!input) return null;

  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const playlistId = url.searchParams.get('list')?.trim();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id && /^[\w-]{11}$/.test(id)) return { type: 'video', id };
      return playlistId ? { type: 'playlist', id: playlistId } : null;
    }

    if (!host.endsWith('youtube.com')) return null;
    if (playlistId && (url.pathname === '/playlist' || !url.searchParams.get('v'))) {
      return { type: 'playlist', id: playlistId };
    }

    const videoId =
      url.searchParams.get('v')?.trim() ||
      (url.pathname.startsWith('/shorts/') ? url.pathname.split('/').filter(Boolean)[1] : '') ||
      (url.pathname.startsWith('/embed/') ? url.pathname.split('/').filter(Boolean)[1] : '');
    if (videoId && /^[\w-]{11}$/.test(videoId)) return { type: 'video', id: videoId };
    if (playlistId) return { type: 'playlist', id: playlistId };
  } catch {
    if (/^[\w-]{11}$/.test(input)) return { type: 'video', id: input };
  }

  return null;
}

async function fetchClipWiseSourceVideos(sourceUrl: string): Promise<NewsYouLearnVideo[]> {
  const youtubeSource = parseYouTubeSource(sourceUrl);
  if (!youtubeSource) return fetchYouLearnSpaceVideos(sourceUrl);

  const videos =
    youtubeSource.type === 'video'
      ? await getVideosByIds([youtubeSource.id])
      : await getVideosByPlaylistId(youtubeSource.id);
  const importedAt = new Date().toISOString();
  return videos.map((video) => ({
    id: `yt:${video.id}`,
    title: video.title,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    thumbnail: video.thumbnail || undefined,
    durationSec: video.durationSec ?? 0,
    importedAt,
  }));
}

function videoListForTarget(state: NewsYouLearnState, target: NewsVideoTarget): NewsYouLearnState['videos'] {
  return target === 'clipwise' ? state.clipwiseVideos ?? [] : state.videos;
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

function mergeRecordVideoList(existing: NewsYouLearnVideo[], incoming: NewsYouLearnVideo[]): NewsYouLearnVideo[] {
  const byId = new Map<string, NewsYouLearnVideo>();
  for (const video of existing) byId.set(video.id, video);
  for (const video of incoming) {
    const current = byId.get(video.id);
    byId.set(video.id, current ? { ...current, ...video, completedAt: video.completedAt ?? current.completedAt } : video);
  }
  return [...byId.values()].slice(0, 500);
}

async function hydrateFromDailyUpscClipWiseTable(
  session: Session | null | undefined,
  state: NewsYouLearnState,
): Promise<NewsYouLearnState> {
  const identity = getTubeoUserIdentity(session);
  if (!identity || !isSupabaseDailyUpscClipWiseConfigured()) return state;

  let records: Awaited<ReturnType<typeof readDailyUpscClipWiseRecords>>;
  try {
    records = await readDailyUpscClipWiseRecords(identity);
  } catch {
    return state;
  }
  if (records.length === 0) return state;

  const upsc = records.filter((record) => record.category === 'upsc');
  const clipwise = records.filter((record) => record.category === 'clipwise');
  const summaries = { ...state.summaries };
  const clipwiseProgress = { ...(state.clipwiseProgress ?? {}) };

  for (const record of upsc) {
    if (record.summary) summaries[summaryKey(record.summary.date, record.summary.videoId, record.summary.noteKind)] = record.summary;
  }

  for (const record of clipwise) {
    if (record.clipwiseProgress) {
      clipwiseProgress[`${record.clipwiseProgress.videoId}:${record.clipwiseProgress.clipSeconds}`] = record.clipwiseProgress;
    }
  }

  return {
    ...state,
    sourceUrl: upsc.find((record) => record.sourceUrl)?.sourceUrl ?? state.sourceUrl,
    clipwiseSourceUrl: clipwise.find((record) => record.sourceUrl)?.sourceUrl ?? state.clipwiseSourceUrl,
    videos: mergeRecordVideoList(state.videos, upsc.map((record) => record.video)),
    clipwiseVideos: mergeRecordVideoList(state.clipwiseVideos ?? [], clipwise.map((record) => record.video)),
    summaries,
    clipwiseProgress,
  };
}

async function persistDailyUpscClipWiseVideos(
  session: Session | null | undefined,
  category: DailyUpscClipWiseCategory,
  videos: NewsYouLearnVideo[],
  sourceUrl: string,
  state: NewsYouLearnState,
): Promise<void> {
  const identity = getTubeoUserIdentity(session);
  if (!identity) return;
  try {
    await Promise.all(
      videos.map((video) =>
        upsertDailyUpscClipWiseRecord(identity, {
          category,
          video,
          sourceUrl,
          markedCompleted: Boolean(video.completedAt),
          summary:
            category === 'upsc'
              ? bestSummaryForVideo(state, video.id)
              : null,
          clipwiseProgress:
            category === 'clipwise'
              ? Object.values(state.clipwiseProgress ?? {}).find((progress) => progress.videoId === video.id) ?? null
              : null,
        }),
      ),
    );
  } catch {
    // The legacy user-state sync remains as a fallback if the new table is not applied yet.
  }
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
  const newsYouLearn = await hydrateFromDailyUpscClipWiseTable(
    session,
    state?.newsYouLearn ?? emptyNewsYouLearnState(),
  );
  const clipwiseVideos = newsYouLearn.clipwiseVideos ?? [];
  if (clipwiseVideos.length === 0) return newsYouLearn;

  const syncedProgress = syncClipWiseProgressForVideos(newsYouLearn.clipwiseProgress, clipwiseVideos);
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
  noteKind: NewsYouLearnNoteKind = 'layered',
): Promise<NewsYouLearnState> {
  const state = await readNewsYouLearnState(session);
  const now = new Date().toISOString();
  const trimmed = prompt.slice(0, 8000);
  if (noteKind === 'analogy') {
    return writeNewsYouLearnState(session, {
      ...state,
      analogyPrompt: trimmed,
      analogyPromptUpdatedAt: now,
    });
  }
  return writeNewsYouLearnState(session, {
    ...state,
    prompt: trimmed,
    promptUpdatedAt: now,
    layeredPrompt: trimmed,
    layeredPromptUpdatedAt: now,
  });
}

export async function importNewsYouLearnSpace(
  session: Session | null | undefined,
  sourceUrl: string,
  target: NewsVideoTarget = 'youlearn',
): Promise<NewsYouLearnState> {
  const videos = target === 'clipwise' ? await fetchClipWiseSourceVideos(sourceUrl) : await fetchYouLearnSpaceVideos(sourceUrl);
  const state = await readNewsYouLearnState(session);
  const mergedVideos = mergeVideos(videoListForTarget(state, target), videos);
  const base = {
    ...state,
  };
  if (target === 'clipwise') {
    const next = await writeNewsYouLearnState(session, {
      ...base,
      clipwiseSourceUrl: sourceUrl.trim(),
      clipwiseImportedAt: new Date().toISOString(),
      clipwiseVideos: mergedVideos,
      clipwiseProgress: syncClipWiseProgressForVideos(state.clipwiseProgress, mergedVideos),
    });
    await persistDailyUpscClipWiseVideos(session, 'clipwise', next.clipwiseVideos ?? [], sourceUrl, next);
    return next;
  }
  const next = await writeNewsYouLearnState(session, {
    ...base,
    sourceUrl: sourceUrl.trim(),
    importedAt: new Date().toISOString(),
    videos: mergedVideos,
    summaries: pruneSummaries(state.summaries, new Set(mergedVideos.map((video) => video.id))),
    selectedVideoIds: pruneSelectedVideoIds(state.selectedVideoIds, new Set(mergedVideos.map((video) => video.id))),
  });
  await persistDailyUpscClipWiseVideos(session, 'upsc', next.videos, sourceUrl, next);
  return next;
}

export async function removeNewsYouLearnVideo(
  session: Session | null | undefined,
  videoId: string,
  target: NewsVideoTarget = 'youlearn',
): Promise<NewsYouLearnState> {
  const state = await readNewsYouLearnState(session);
  const videos = videoListForTarget(state, target).filter((video) => video.id !== videoId);
  if (target === 'clipwise') {
    const next = await writeNewsYouLearnState(session, {
      ...state,
      clipwiseVideos: videos,
      clipwiseProgress: pruneClipWiseProgress(state.clipwiseProgress, new Set(videos.map((video) => video.id))),
    });
    const identity = getTubeoUserIdentity(session);
    if (identity) {
      try {
        await deleteDailyUpscClipWiseRecord(identity, 'clipwise', videoId);
      } catch {
        // Legacy sync remains authoritative until the new table is available.
      }
    }
    return next;
  }
  const next = await writeNewsYouLearnState(session, {
    ...state,
    videos,
    summaries: pruneSummaries(state.summaries, new Set(videos.map((video) => video.id))),
    selectedVideoIds: pruneSelectedVideoIds(state.selectedVideoIds, new Set(videos.map((video) => video.id))),
    clipwiseProgress: pruneClipWiseProgress(state.clipwiseProgress, new Set(videos.map((video) => video.id))),
  });
  const identity = getTubeoUserIdentity(session);
  if (identity) {
    try {
      await deleteDailyUpscClipWiseRecord(identity, 'upsc', videoId);
    } catch {
      // Legacy sync remains authoritative until the new table is available.
    }
  }
  return next;
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
  const next = await writeNewsYouLearnState(session, {
    ...state,
    videos,
  });
  const identity = getTubeoUserIdentity(session);
  const video = videos.find((item) => item.id === videoId);
  if (identity && video) {
    try {
      await upsertDailyUpscClipWiseRecord(identity, {
        category: 'upsc',
        video,
        sourceUrl: state.sourceUrl,
        markedCompleted: true,
        summary: bestSummaryForVideo(state, video.id),
      });
    } catch {
      // Legacy sync remains authoritative until the new table is available.
    }
  }
  return next;
}

export async function clearNewsYouLearnVideos(
  session: Session | null | undefined,
  target: NewsVideoTarget = 'youlearn',
): Promise<NewsYouLearnState> {
  const state = await readNewsYouLearnState(session);
  if (target === 'clipwise') {
    const next = await writeNewsYouLearnState(session, {
      ...state,
      clipwiseVideos: [],
      clipwiseProgress: {},
    });
    const identity = getTubeoUserIdentity(session);
    if (identity) {
      try {
        await clearDailyUpscClipWiseRecords(identity, 'clipwise');
      } catch {
        // Legacy sync remains authoritative until the new table is available.
      }
    }
    return next;
  }
  const next = await writeNewsYouLearnState(session, {
    ...state,
    videos: [],
    summaries: {},
    selectedVideoIds: {},
    clipwiseProgress: {},
  });
  const identity = getTubeoUserIdentity(session);
  if (identity) {
    try {
      await clearDailyUpscClipWiseRecords(identity, 'upsc');
    } catch {
      // Legacy sync remains authoritative until the new table is available.
    }
  }
  return next;
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
  const clipwiseVideos = state.clipwiseVideos?.length ? state.clipwiseVideos : state.videos;
  const video = clipwiseVideos.find((item) => item.id === videoId);
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
    ? clipwiseVideos.map((item) => (item.id === videoId ? { ...item, completedAt: item.completedAt || completedAt } : item))
    : clipwiseVideos;
  const next = await writeNewsYouLearnState(session, {
    ...state,
    clipwiseVideos: videos,
    clipwiseProgress: {
      ...(state.clipwiseProgress ?? {}),
      [key]: progress,
    },
  });
  const identity = getTubeoUserIdentity(session);
  const syncedVideo = videos.find((item) => item.id === videoId);
  if (identity && syncedVideo) {
    try {
      await upsertDailyUpscClipWiseRecord(identity, {
        category: 'clipwise',
        video: syncedVideo,
        sourceUrl: state.clipwiseSourceUrl,
        markedCompleted: Boolean(progress.completedAt),
        clipwiseProgress: progress,
      });
    } catch {
      // Legacy sync remains authoritative until the new table is available.
    }
  }

  return { state: next, progress: next.clipwiseProgress?.[key] ?? progress };
}

export async function processDailyNewsYouLearnVideo(
  session: Session | null | undefined,
  date: string,
  options: { force?: boolean; videoId?: string; fallbackVideos?: unknown; noteKind?: NewsYouLearnNoteKind } = {},
): Promise<{ state: NewsYouLearnState; summary: NewsYouLearnVideoSummary }> {
  let state = await readNewsYouLearnState(session);
  const noteKind = options.noteKind === 'analogy' ? 'analogy' : 'layered';
  const requestedVideoId = options.videoId?.trim() || state.selectedVideoIds?.[date] || '';
  if (requestedVideoId && !state.videos.some((item) => item.id === requestedVideoId)) {
    const fallbackVideos = normalizeFallbackVideos(options.fallbackVideos);
    const repairedVideos = mergeVideos(state.videos, fallbackVideos);
    if (repairedVideos.some((item) => item.id === requestedVideoId)) {
      state = await writeNewsYouLearnState(session, {
        ...state,
        importedAt: state.importedAt || new Date().toISOString(),
        videos: repairedVideos,
        summaries: pruneSummaries(state.summaries, new Set(repairedVideos.map((video) => video.id))),
        selectedVideoIds: pruneSelectedVideoIds(state.selectedVideoIds, new Set(repairedVideos.map((video) => video.id))),
        clipwiseProgress: syncClipWiseProgressForVideos(state.clipwiseProgress, repairedVideos),
      });
    }
  }
  const dailyVideo = pickDailyYouLearnVideo(state.videos, date);
  const video = state.videos.find((item) => item.id === requestedVideoId) ?? dailyVideo;
  if (!video) throw new Error('Import a YouLearn space before processing daily video.');

  const prompt = promptForKind(state, noteKind);
  const promptH = promptHash(prompt);
  const key = summaryKey(date, video.id, noteKind);
  const legacyKey = `${date}:${video.id}`;
  const cached =
    state.summaries[key] ??
    (noteKind === 'layered' && state.summaries[legacyKey]?.videoId === video.id ? state.summaries[legacyKey] : null) ??
    (noteKind === 'layered' && state.summaries[date]?.videoId === video.id ? state.summaries[date] : null);
  if (!options.force && cached?.videoId === video.id && cached.promptHash === promptH) {
    const next =
      state.selectedVideoIds?.[date] === video.id
        ? state
        : await writeNewsYouLearnState(session, {
            ...state,
            selectedVideoIds: {
              ...(state.selectedVideoIds ?? {}),
              [date]: video.id,
            },
          });
    const identity = getTubeoUserIdentity(session);
    if (identity) {
      try {
        await upsertDailyUpscClipWiseRecord(identity, {
          category: 'upsc',
          video,
          sourceUrl: state.sourceUrl,
          markedCompleted: Boolean(video.completedAt),
          summary: cached,
        });
      } catch {
        // Legacy sync remains authoritative until the new table is available.
      }
    }
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
    userPrompt: prompt,
  });

  const summary: NewsYouLearnVideoSummary = {
    date,
    videoId: video.id,
    videoTitle: video.title,
    videoUrl: video.url,
    thumbnail: video.thumbnail,
    noteKind,
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
  const identity = getTubeoUserIdentity(session);
  if (identity) {
    try {
      await upsertDailyUpscClipWiseRecord(identity, {
        category: 'upsc',
        video,
        sourceUrl: state.sourceUrl,
        markedCompleted: Boolean(video.completedAt),
        summary,
      });
    } catch {
      // Legacy sync remains authoritative until the new table is available.
    }
  }
  return { state: next, summary };
}
