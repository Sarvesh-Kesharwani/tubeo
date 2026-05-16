import 'server-only';

import type { Session } from 'next-auth';
import { DEFAULT_CHANNEL_SPACE } from './types';
import { DEFAULT_VIEW_PREFERENCES } from './view-preferences';
import {
  buildDriveChannelData,
  normalizeDriveChannelData,
  normalizeQuotaUsage,
  type DriveChannelData,
  type DriveSyncState,
  type DriveWriteState,
} from './drive';

const DEFAULT_TABLE = 'tubeo_user_sync_state';

export interface TubeoUserIdentity {
  ownerKey: string;
  email: string;
  name: string | null;
}

interface SupabaseSyncRow {
  owner_key: string;
  user_email: string;
  user_name: string | null;
  state: DriveChannelData;
  state_updated_at: string;
  updated_at?: string;
}

function config(): { url: string; key: string; table: string } | null {
  const url = process.env.TUBEO_SUPABASE_URL?.trim();
  const key =
    process.env.TUBEO_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_SECRET_KEY?.trim();
  const table = process.env.TUBEO_SUPABASE_SYNC_TABLE?.trim() || DEFAULT_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, table };
}

export function isSupabaseSyncConfigured(): boolean {
  return Boolean(config());
}

export function getTubeoUserIdentity(session: Session | null | undefined): TubeoUserIdentity | null {
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return null;

  return {
    ownerKey: `google:${email}`,
    email,
    name: session?.user?.name ?? null,
  };
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function tableUrl(baseUrl: string, table: string): string {
  return `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
}

export async function readSupabaseSyncState(identity: TubeoUserIdentity): Promise<DriveSyncState | null> {
  const cfg = config();
  if (!cfg) return null;

  const qs = new URLSearchParams({
    owner_key: `eq.${identity.ownerKey}`,
    select: 'owner_key,user_email,user_name,state,state_updated_at,updated_at',
    limit: '1',
  });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    headers: headers(cfg.key),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase sync read failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await res.json()) as SupabaseSyncRow[];
  return normalizeDriveChannelData(rows[0]?.state ?? null);
}

export async function writeSupabaseSyncState(
  identity: TubeoUserIdentity,
  store: DriveWriteState,
): Promise<DriveSyncState> {
  const cfg = config();
  if (!cfg) throw new Error('Tubeo Supabase sync is not configured.');

  const state = buildDriveChannelData(store);
  const row: SupabaseSyncRow = {
    owner_key: identity.ownerKey,
    user_email: identity.email,
    user_name: identity.name,
    state,
    state_updated_at: state.updatedAt,
  };
  const qs = new URLSearchParams({ on_conflict: 'owner_key' });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'POST',
    headers: {
      ...headers(cfg.key),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase sync write failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await res.json()) as SupabaseSyncRow[];
  const normalized = normalizeDriveChannelData(rows[0]?.state ?? state);
  if (!normalized) throw new Error('Supabase sync returned invalid state.');
  return normalized;
}

export async function resetSupabaseDailyUsage(): Promise<{ reset: number }> {
  const cfg = config();
  if (!cfg) throw new Error('Tubeo Supabase sync is not configured.');

  const qs = new URLSearchParams({
    select: 'owner_key,user_email,user_name,state,state_updated_at,updated_at',
    limit: '1000',
  });
  const read = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    headers: headers(cfg.key),
    cache: 'no-store',
  });
  if (!read.ok) {
    const detail = await read.text().catch(() => '');
    throw new Error(`Supabase usage reset read failed: ${read.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await read.json()) as SupabaseSyncRow[];
  const now = new Date().toISOString();
  const emptyQuota = normalizeQuotaUsage(null);
  await Promise.all(
    rows.map(async (row) => {
      const normalized = normalizeDriveChannelData(row.state);
      const state: DriveChannelData = buildDriveChannelData({
        channels: normalized?.channels ?? [],
        spaces: normalized?.spaces ?? [DEFAULT_CHANNEL_SPACE],
        view: normalized?.view ?? DEFAULT_VIEW_PREFERENCES,
        viewUpdatedAt: normalized?.viewUpdatedAt ?? now,
        updatesChannelIds: normalized?.updatesChannelIds ?? [],
        vocabs: normalized?.vocabs ?? [],
        ignoredChannels: normalized?.ignoredChannels ?? [],
        discoverSearches: normalized?.discoverSearches ?? [],
        activeDiscoverSearchId: normalized?.activeDiscoverSearchId,
        discoverDraft: normalized?.discoverDraft,
        lastPagePath: normalized?.lastPagePath,
        quota: emptyQuota,
        deepseekQuota: emptyQuota,
        quotaHistory: normalized?.quotaHistory,
        deepseekQuotaHistory: normalized?.deepseekQuotaHistory,
      });
      const update = await fetch(`${tableUrl(cfg.url, cfg.table)}?owner_key=eq.${encodeURIComponent(row.owner_key)}`, {
        method: 'PATCH',
        headers: {
          ...headers(cfg.key),
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          state,
          state_updated_at: now,
        }),
        cache: 'no-store',
      });
      if (!update.ok) {
        const detail = await update.text().catch(() => '');
        throw new Error(`Supabase usage reset write failed: ${update.status} ${detail.slice(0, 200)}`);
      }
    }),
  );

  return { reset: rows.length };
}
