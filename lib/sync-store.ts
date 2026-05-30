import 'server-only';

import type { Session } from 'next-auth';
import { readDriveChannels, writeDriveChannels, type DriveSyncState, type DriveWriteState } from './drive';
import {
  getTubeoUserIdentity,
  isSupabaseSyncConfigured,
  readSupabaseSyncState,
  writeSupabaseSyncState,
} from './supabase-sync';

export type SyncStoreSource = 'supabase' | 'drive' | 'none';

export interface SyncStoreReadResult {
  state: DriveSyncState | null;
  source: SyncStoreSource;
  seededSupabase?: boolean;
}

export interface SyncStoreWriteResult {
  state: DriveSyncState | null;
  source: Exclude<SyncStoreSource, 'none'>;
  driveBackupOk: boolean;
}

function hasNewsYouLearnData(state: DriveSyncState['newsYouLearn'] | null | undefined): boolean {
  if (!state) return false;
  return (
    state.videos.length > 0 ||
    (state.clipwiseVideos?.length ?? 0) > 0 ||
    Object.keys(state.summaries ?? {}).length > 0 ||
    Object.keys(state.selectedVideoIds ?? {}).length > 0 ||
    Object.keys(state.clipwiseProgress ?? {}).length > 0 ||
    Boolean(state.sourceUrl.trim()) ||
    Boolean(state.clipwiseSourceUrl?.trim()) ||
    Boolean(state.prompt.trim())
  );
}

function updatedTime(state: DriveSyncState | null | undefined): number {
  const parsed = Date.parse(state?.updatedAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function fieldTime(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

type NewsYouLearnSyncState = NonNullable<DriveSyncState['newsYouLearn']>;
type NewsYouLearnSyncVideo = NewsYouLearnSyncState['videos'][number];
type NewsYouLearnSyncSummary = NewsYouLearnSyncState['summaries'][string];
type NewsYouLearnSyncProgress = NonNullable<NewsYouLearnSyncState['clipwiseProgress']>[string];

function mergeVideoList(
  incoming: NewsYouLearnSyncState['videos'] | undefined,
  existing: NewsYouLearnSyncState['videos'] | undefined,
): NewsYouLearnSyncState['videos'] {
  const byId = new Map<string, NewsYouLearnSyncVideo>();
  for (const video of incoming ?? []) {
    byId.set(video.id, video);
  }
  for (const video of existing ?? []) {
    const current = byId.get(video.id);
    if (!current) {
      byId.set(video.id, video);
      continue;
    }
    byId.set(video.id, {
      ...video,
      ...current,
      completedAt:
        fieldTime(current.completedAt) >= fieldTime(video.completedAt)
          ? current.completedAt
          : video.completedAt,
    });
  }
  return [...byId.values()].slice(0, 500);
}

function mergeSummaries(
  incoming: NewsYouLearnSyncState['summaries'] | undefined,
  existing: NewsYouLearnSyncState['summaries'] | undefined,
): NewsYouLearnSyncState['summaries'] {
  const out: NewsYouLearnSyncState['summaries'] = { ...(existing ?? {}) };
  for (const [key, summary] of Object.entries(incoming ?? {})) {
    const current = out[key];
    out[key] =
      !current || fieldTime(summary.generatedAt) >= fieldTime(current.generatedAt)
        ? summary
        : current;
  }
  return Object.fromEntries(Object.entries(out).slice(-90));
}

function mergeClipWiseProgress(
  incoming: NewsYouLearnSyncState['clipwiseProgress'] | undefined,
  existing: NewsYouLearnSyncState['clipwiseProgress'] | undefined,
): NewsYouLearnSyncState['clipwiseProgress'] {
  const out: NonNullable<NewsYouLearnSyncState['clipwiseProgress']> = { ...(existing ?? {}) };
  for (const [key, progress] of Object.entries(incoming ?? {})) {
    const current = out[key] as NewsYouLearnSyncProgress | undefined;
    out[key] =
      !current || fieldTime(progress.updatedAt) >= fieldTime(current.updatedAt)
        ? progress
        : current;
  }
  return out;
}

function newerImportMeta(
  incomingUrl: string | undefined,
  incomingAt: string | undefined,
  existingUrl: string | undefined,
  existingAt: string | undefined,
): { url: string; importedAt: string } {
  const incomingTime = fieldTime(incomingAt);
  const existingTime = fieldTime(existingAt);
  if ((incomingUrl?.trim() || incomingTime > 0) && incomingTime >= existingTime) {
    return { url: incomingUrl?.trim() ?? '', importedAt: incomingAt ?? new Date(0).toISOString() };
  }
  return { url: existingUrl?.trim() ?? '', importedAt: existingAt ?? new Date(0).toISOString() };
}

function mergeNewsYouLearn(
  incoming: DriveWriteState['newsYouLearn'],
  existing: DriveSyncState['newsYouLearn'] | null | undefined,
): DriveWriteState['newsYouLearn'] {
  if (!hasNewsYouLearnData(incoming)) return existing ?? undefined;
  if (!hasNewsYouLearnData(existing)) return incoming;

  const source = newerImportMeta(incoming?.sourceUrl, incoming?.importedAt, existing?.sourceUrl, existing?.importedAt);
  const clipwiseSource = newerImportMeta(
    incoming?.clipwiseSourceUrl,
    incoming?.clipwiseImportedAt,
    existing?.clipwiseSourceUrl,
    existing?.clipwiseImportedAt,
  );
  const incomingPromptTime = fieldTime(incoming?.promptUpdatedAt);
  const existingPromptTime = fieldTime(existing?.promptUpdatedAt);
  const useIncomingPrompt = incomingPromptTime >= existingPromptTime || !existing?.prompt?.trim();

  return {
    sourceUrl: source.url,
    importedAt: source.importedAt,
    clipwiseSourceUrl: clipwiseSource.url,
    clipwiseImportedAt: clipwiseSource.importedAt,
    prompt: useIncomingPrompt ? incoming?.prompt ?? '' : existing?.prompt ?? '',
    promptUpdatedAt: useIncomingPrompt
      ? incoming?.promptUpdatedAt ?? new Date(0).toISOString()
      : existing?.promptUpdatedAt ?? new Date(0).toISOString(),
    videos: mergeVideoList(incoming?.videos, existing?.videos),
    clipwiseVideos: mergeVideoList(incoming?.clipwiseVideos, existing?.clipwiseVideos),
    summaries: mergeSummaries(incoming?.summaries, existing?.summaries),
    selectedVideoIds: {
      ...(existing?.selectedVideoIds ?? {}),
      ...(incoming?.selectedVideoIds ?? {}),
    },
    clipwiseProgress: mergeClipWiseProgress(incoming?.clipwiseProgress, existing?.clipwiseProgress),
  };
}

function mergeNewsYouLearnIntoStore<T extends DriveWriteState>(
  incoming: T,
  existing: DriveSyncState | null | undefined,
): T {
  return {
    ...incoming,
    newsYouLearn: mergeNewsYouLearn(incoming.newsYouLearn, existing?.newsYouLearn),
  };
}

export async function readUserSyncState(session: Session | null | undefined): Promise<SyncStoreReadResult> {
  const identity = getTubeoUserIdentity(session);
  const accessToken = session?.accessToken;

  if (identity && isSupabaseSyncConfigured()) {
    const supabaseState = await readSupabaseSyncState(identity);
    if (supabaseState) {
      if (!accessToken) return { state: supabaseState, source: 'supabase' };

      let driveState: DriveSyncState | null = null;
      try {
        driveState = await readDriveChannels(accessToken);
      } catch {
        driveState = null;
      }
      if (driveState && updatedTime(driveState) > updatedTime(supabaseState)) {
        const mergedDriveState = mergeNewsYouLearnIntoStore(driveState, supabaseState);
        try {
          const written = await writeSupabaseSyncState(identity, mergedDriveState);
          try {
            await writeDriveChannels(accessToken, mergedDriveState);
          } catch {
            // Supabase is the primary store; Drive backup will retry on the next write.
          }
          return { state: written, source: 'drive', seededSupabase: true };
        } catch {
          return { state: mergedDriveState, source: 'drive' };
        }
      }

      return { state: supabaseState, source: 'supabase' };
    }

    if (accessToken) {
      const driveState = await readDriveChannels(accessToken);
      if (driveState) {
        try {
          await writeSupabaseSyncState(identity, driveState);
        } catch {
          return { state: driveState, source: 'drive' };
        }
        return { state: driveState, source: 'drive', seededSupabase: true };
      }
    }

    return { state: null, source: 'none' };
  }

  if (!accessToken) return { state: null, source: 'none' };
  return { state: await readDriveChannels(accessToken), source: 'drive' };
}

export async function writeUserSyncState(
  session: Session | null | undefined,
  store: DriveWriteState,
  options: { mergeNewsYouLearn?: boolean } = {},
): Promise<SyncStoreWriteResult> {
  const identity = getTubeoUserIdentity(session);
  const accessToken = session?.accessToken;
  let driveBackupOk = false;
  let stateToWrite = store;

  if (identity && isSupabaseSyncConfigured()) {
    const existing = await readSupabaseSyncState(identity);
    if (options.mergeNewsYouLearn !== false) {
      stateToWrite = mergeNewsYouLearnIntoStore(stateToWrite, existing);
    }
    if (
      !stateToWrite.quota ||
      !stateToWrite.deepseekQuota ||
      !stateToWrite.quotaHistory ||
      !stateToWrite.deepseekQuotaHistory ||
      !stateToWrite.newsYouLearn
    ) {
      stateToWrite = {
        ...stateToWrite,
        quota: stateToWrite.quota ?? existing?.quota,
        deepseekQuota: stateToWrite.deepseekQuota ?? existing?.deepseekQuota,
        quotaHistory: stateToWrite.quotaHistory ?? existing?.quotaHistory,
        deepseekQuotaHistory: stateToWrite.deepseekQuotaHistory ?? existing?.deepseekQuotaHistory,
        newsYouLearn: stateToWrite.newsYouLearn ?? existing?.newsYouLearn,
      };
    }
    let state: DriveSyncState;
    try {
      state = await writeSupabaseSyncState(identity, stateToWrite);
    } catch (error) {
      if (!accessToken) throw error;
      await writeDriveChannels(accessToken, stateToWrite);
      return { state: null, source: 'drive', driveBackupOk: true };
    }
    if (accessToken) {
      try {
        await writeDriveChannels(accessToken, stateToWrite);
        driveBackupOk = true;
      } catch {
        driveBackupOk = false;
      }
    }
    return { state, source: 'supabase', driveBackupOk };
  }

  if (!accessToken) throw new Error('No sync destination configured.');
  const existing = await readDriveChannels(accessToken);
  if (options.mergeNewsYouLearn !== false) {
    stateToWrite = mergeNewsYouLearnIntoStore(stateToWrite, existing);
  }
  if (
    !stateToWrite.quota ||
    !stateToWrite.deepseekQuota ||
    !stateToWrite.quotaHistory ||
    !stateToWrite.deepseekQuotaHistory ||
    !stateToWrite.newsYouLearn
  ) {
    stateToWrite = {
      ...stateToWrite,
      quota: stateToWrite.quota ?? existing?.quota,
      deepseekQuota: stateToWrite.deepseekQuota ?? existing?.deepseekQuota,
      quotaHistory: stateToWrite.quotaHistory ?? existing?.quotaHistory,
      deepseekQuotaHistory: stateToWrite.deepseekQuotaHistory ?? existing?.deepseekQuotaHistory,
      newsYouLearn: stateToWrite.newsYouLearn ?? existing?.newsYouLearn,
    };
  }
  await writeDriveChannels(accessToken, stateToWrite);
  return { state: null, source: 'drive', driveBackupOk: true };
}
