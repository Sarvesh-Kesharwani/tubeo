'use client';

import type { ViewPreferences } from './types';
import { DEFAULT_VIEW_PREFERENCES, normalizeViewPreferences } from './view-preferences';

const STORAGE_KEY = 'tubeo_filter_state_v1';
const EPOCH = new Date(0).toISOString();

export interface PersistedFilterState {
  filters: ViewPreferences;
  updatedAt: string;
}

export interface FilterSyncResult extends PersistedFilterState {
  source: 'local' | 'drive' | 'cookie';
  synced: boolean;
}

function fallbackState(): PersistedFilterState {
  return {
    filters: DEFAULT_VIEW_PREFERENCES,
    updatedAt: EPOCH,
  };
}

function parseStoredState(raw: string | null): PersistedFilterState {
  if (!raw) return fallbackState();

  try {
    const parsed = JSON.parse(raw) as { filters?: Partial<ViewPreferences>; updatedAt?: string } | null;
    return {
      filters: normalizeViewPreferences(parsed?.filters),
      updatedAt: parsed?.updatedAt || EPOCH,
    };
  } catch {
    return fallbackState();
  }
}

export function loadState(): PersistedFilterState {
  if (typeof window === 'undefined') return fallbackState();
  return parseStoredState(window.localStorage.getItem(STORAGE_KEY));
}

export function saveState(filters: Partial<ViewPreferences>, updatedAt = new Date().toISOString()): PersistedFilterState {
  const current = loadState();
  const next: PersistedFilterState = {
    filters: normalizeViewPreferences({
      ...current.filters,
      ...filters,
    }),
    updatedAt,
  };

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  return next;
}

export async function syncWithDrive(): Promise<FilterSyncResult> {
  const local = loadState();

  try {
    const res = await fetch('/api/view-preferences/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(local),
    });

    if (!res.ok) {
      return { ...local, source: 'local', synced: false };
    }

    const data = (await res.json()) as {
      filters?: Partial<ViewPreferences>;
      updatedAt?: string;
      source?: FilterSyncResult['source'];
      synced?: boolean;
    };
    const resolved = saveState(normalizeViewPreferences(data.filters), data.updatedAt || local.updatedAt);

    return {
      ...resolved,
      source: data.source ?? 'local',
      synced: Boolean(data.synced),
    };
  } catch {
    return { ...local, source: 'local', synced: false };
  }
}
