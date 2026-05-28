import 'server-only';

import { createHash } from 'crypto';
import type { Session } from 'next-auth';
import { emptyNewsYouLearnState } from './drive';
import { summarizeYouLearnNewsTranscript, type YouLearnNewsTranscriptResult } from './deepseek';
import { DEFAULT_CHANNEL_SPACE, type ChannelPreferenceStore, type NewsYouLearnState, type NewsYouLearnVideoSummary } from './types';
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
  return state?.newsYouLearn ?? emptyNewsYouLearnState();
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
  return writeNewsYouLearnState(session, {
    ...state,
    prompt: prompt.slice(0, 8000),
  });
}

export async function importNewsYouLearnSpace(
  session: Session | null | undefined,
  sourceUrl: string,
): Promise<NewsYouLearnState> {
  const videos = await fetchYouLearnSpaceVideos(sourceUrl);
  const state = await readNewsYouLearnState(session);
  return writeNewsYouLearnState(session, {
    ...state,
    sourceUrl: sourceUrl.trim(),
    importedAt: new Date().toISOString(),
    videos,
  });
}

export async function processDailyNewsYouLearnVideo(
  session: Session | null | undefined,
  date: string,
  options: { force?: boolean } = {},
): Promise<{ state: NewsYouLearnState; summary: NewsYouLearnVideoSummary }> {
  const state = await readNewsYouLearnState(session);
  const video = pickDailyYouLearnVideo(state.videos, date);
  if (!video) throw new Error('Import a YouLearn space before processing daily video.');

  const promptH = promptHash(state.prompt);
  const cached = state.summaries[date];
  if (!options.force && cached?.videoId === video.id && cached.promptHash === promptH) {
    return { state, summary: cached };
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
    summaries: {
      ...state.summaries,
      [date]: summary,
    },
  });
  return { state: next, summary };
}
