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

export async function readUserSyncState(session: Session | null | undefined): Promise<SyncStoreReadResult> {
  const identity = getTubeoUserIdentity(session);
  const accessToken = session?.accessToken;

  if (identity && isSupabaseSyncConfigured()) {
    const supabaseState = await readSupabaseSyncState(identity);
    if (supabaseState) return { state: supabaseState, source: 'supabase' };

    if (accessToken) {
      const driveState = await readDriveChannels(accessToken);
      if (driveState) {
        await writeSupabaseSyncState(identity, driveState);
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
    if (
      !stateToWrite.quota ||
      !stateToWrite.deepseekQuota ||
      !stateToWrite.quotaHistory ||
      !stateToWrite.deepseekQuotaHistory
    ) {
      const existing = await readSupabaseSyncState(identity);
      stateToWrite = {
        ...stateToWrite,
        quota: stateToWrite.quota ?? existing?.quota,
        deepseekQuota: stateToWrite.deepseekQuota ?? existing?.deepseekQuota,
        quotaHistory: stateToWrite.quotaHistory ?? existing?.quotaHistory,
        deepseekQuotaHistory: stateToWrite.deepseekQuotaHistory ?? existing?.deepseekQuotaHistory,
      };
    }
    const state = await writeSupabaseSyncState(identity, stateToWrite);
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
  if (
    !stateToWrite.quota ||
    !stateToWrite.deepseekQuota ||
    !stateToWrite.quotaHistory ||
    !stateToWrite.deepseekQuotaHistory
  ) {
    const existing = await readDriveChannels(accessToken);
    stateToWrite = {
      ...stateToWrite,
      quota: stateToWrite.quota ?? existing?.quota,
      deepseekQuota: stateToWrite.deepseekQuota ?? existing?.deepseekQuota,
      quotaHistory: stateToWrite.quotaHistory ?? existing?.quotaHistory,
      deepseekQuotaHistory: stateToWrite.deepseekQuotaHistory ?? existing?.deepseekQuotaHistory,
    };
  }
  await writeDriveChannels(accessToken, stateToWrite);
  return { state: null, source: 'drive', driveBackupOk: true };
}
