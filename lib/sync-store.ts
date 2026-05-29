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

function preserveNewsYouLearn(
  incoming: DriveWriteState['newsYouLearn'],
  existing: DriveSyncState | null | undefined,
): DriveWriteState['newsYouLearn'] {
  if (hasNewsYouLearnData(incoming) || !hasNewsYouLearnData(existing?.newsYouLearn)) {
    return incoming;
  }
  return existing?.newsYouLearn;
}

function updatedTime(state: DriveSyncState | null | undefined): number {
  const parsed = Date.parse(state?.updatedAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
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
        try {
          await writeSupabaseSyncState(identity, driveState);
        } catch {
          return { state: driveState, source: 'drive' };
        }
        return { state: driveState, source: 'drive', seededSupabase: true };
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
): Promise<SyncStoreWriteResult> {
  const identity = getTubeoUserIdentity(session);
  const accessToken = session?.accessToken;
  let driveBackupOk = false;
  let stateToWrite = store;

  if (identity && isSupabaseSyncConfigured()) {
    const existing = await readSupabaseSyncState(identity);
    stateToWrite = {
      ...stateToWrite,
      newsYouLearn: preserveNewsYouLearn(stateToWrite.newsYouLearn, existing),
    };
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
  stateToWrite = {
    ...stateToWrite,
    newsYouLearn: preserveNewsYouLearn(stateToWrite.newsYouLearn, existing),
  };
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
