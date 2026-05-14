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

  if (identity && isSupabaseSyncConfigured()) {
    const state = await writeSupabaseSyncState(identity, store);
    if (accessToken) {
      try {
        await writeDriveChannels(accessToken, store);
        driveBackupOk = true;
      } catch {
        driveBackupOk = false;
      }
    }
    return { state, source: 'supabase', driveBackupOk };
  }

  if (!accessToken) throw new Error('No sync destination configured.');
  await writeDriveChannels(accessToken, store);
  return { state: null, source: 'drive', driveBackupOk: true };
}
