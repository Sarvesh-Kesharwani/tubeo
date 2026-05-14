'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { syncWithDrive } from '@/lib/filter-persistence';

type SyncState = 'loading' | 'synced' | 'unsynced' | 'syncing' | 'no-auth';

const PULLED_KEY = 'tubeo_drive_pulled';
const PULLED_AT_KEY = 'tubeo_drive_pulled_at';
const SYNC_CACHE_KEY = 'tubeo_sync_state_v1';
const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';
const SYNC_RESUME_EVENT = 'tubeo-sync-resume';
const SYNC_RESET_EVENT = 'tubeo-sync-reset';
const SYNC_CHECK_STALE_MS = 90_000;
const SYNC_RESUME_STALE_MS = 5 * 60_000;
const DRIVE_PULL_STALE_MS = 5 * 60_000;
const AUTO_SYNC_DEBOUNCE_MS = 1_200;

type CachedSyncState = {
  state: Exclude<SyncState, 'loading' | 'syncing'>;
  lastSynced: string | null;
  checkedAt: number;
};

let memorySync: CachedSyncState | null = null;

function readSyncCache(): CachedSyncState | null {
  if (memorySync) return memorySync;
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(SYNC_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSyncState;
    if (!['synced', 'unsynced', 'no-auth'].includes(parsed.state)) return null;
    memorySync = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeSyncCache(state: CachedSyncState) {
  memorySync = state;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(state));
}

function clearSyncCache() {
  memorySync = null;
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SYNC_CACHE_KEY);
}

function markPulled() {
  sessionStorage.setItem(PULLED_KEY, '1');
  localStorage.setItem(PULLED_AT_KEY, String(Date.now()));
}

function wasPulledRecently() {
  if (sessionStorage.getItem(PULLED_KEY)) return true;
  const pulledAt = Number(localStorage.getItem(PULLED_AT_KEY) ?? 0);
  return Number.isFinite(pulledAt) && Date.now() - pulledAt < DRIVE_PULL_STALE_MS;
}

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>('loading');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const checkingRef = useRef(false);
  const lastCheckRef = useRef(0);
  const resumeRef = useRef(0);
  const autoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyState = useCallback((nextState: CachedSyncState['state'], nextLastSynced: string | null) => {
    lastCheckRef.current = Date.now();
    setState(nextState);
    setLastSynced(nextLastSynced);
    writeSyncCache({ state: nextState, lastSynced: nextLastSynced, checkedAt: lastCheckRef.current });
  }, []);

  const checkSync = useCallback(async (force = false, staleMs = SYNC_CHECK_STALE_MS) => {
    if (syncingRef.current || checkingRef.current) return;
    const cache = readSyncCache();
    if (!force && cache && Date.now() - cache.checkedAt < staleMs) {
      setState(cache.state);
      setLastSynced(cache.lastSynced);
      lastCheckRef.current = cache.checkedAt;
      return;
    }

    checkingRef.current = true;

    try {
      const response = await fetch('/api/drive/sync', { cache: 'no-store' });
      if (response.status === 401) { applyState('no-auth', null); return; }
      if (!response.ok) { applyState('unsynced', null); return; }
      const data = await response.json();
      applyState(data.synced ? 'synced' : 'unsynced', data.updatedAt ?? null);
    } catch {
      applyState('unsynced', null);
    } finally {
      checkingRef.current = false;
    }
  }, [applyState]);

  const pushSync = useCallback(async (background = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    if (!background) {
      setState('syncing');
    }

    try {
      const response = await fetch('/api/drive/sync', { method: 'POST' });
      if (response.status === 401) { applyState('no-auth', null); return; }
      if (!response.ok) { applyState('unsynced', null); return; }
      const data = await response.json();

      if (data.initialized || data.driveWins || data.seededFromLocal) {
        markPulled();
        applyState('synced', data.updatedAt ?? new Date().toISOString());
        if (data.replacedLocal || data.seededFromLocal) {
          router.refresh();
        }
        return;
      }

      applyState('synced', data.updatedAt ?? new Date().toISOString());
    } catch {
      applyState('unsynced', null);
    } finally {
      syncingRef.current = false;
    }
  }, [applyState, router]);

  // Resolve local filters against Drive once per fresh login window, not on every tab click.
  useEffect(() => {
    const cached = readSyncCache();
    if (cached) {
      setState(cached.state);
      setLastSynced(cached.lastSynced);
      lastCheckRef.current = cached.checkedAt;
    }

    if (wasPulledRecently()) {
      void checkSync(false);
      return;
    }

    syncWithDrive()
      .then((result) => {
        markPulled();
        applyState(result.synced ? 'synced' : 'unsynced', result.updatedAt);
        void checkSync(false);
        if (result.source === 'drive') router.refresh();
      })
      .catch(() => void checkSync(true));
  }, [applyState, checkSync, router]);

  useEffect(() => {
    const onChannelsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ autoSync?: boolean; debounceMs?: number }>).detail;
      setLastSynced(null);
      setState('unsynced');
      writeSyncCache({ state: 'unsynced', lastSynced: null, checkedAt: Date.now() });

      if (detail?.autoSync) {
        if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
        autoSyncTimerRef.current = setTimeout(() => {
          autoSyncTimerRef.current = null;
          void pushSync(true);
        }, detail.debounceMs ?? AUTO_SYNC_DEBOUNCE_MS);
      } else {
        void checkSync(true);
      }
    };

    window.addEventListener(CHANNELS_CHANGED_EVENT, onChannelsChanged);
    return () => {
      window.removeEventListener(CHANNELS_CHANGED_EVENT, onChannelsChanged);
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    };
  }, [checkSync, pushSync]);

  // Slow background check. Fast nav should not hit Drive.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void checkSync(false, SYNC_RESUME_STALE_MS);
    }, SYNC_RESUME_STALE_MS);
    return () => clearInterval(id);
  }, [checkSync]);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - resumeRef.current < 2_000) return;
      resumeRef.current = now;
      if (now - lastCheckRef.current < SYNC_RESUME_STALE_MS) return;
      if (state === 'no-auth') {
        sessionStorage.removeItem(PULLED_KEY);
        localStorage.removeItem(PULLED_AT_KEY);
      }
      void checkSync(false, SYNC_RESUME_STALE_MS);
    };

    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [checkSync, state]);

  useEffect(() => {
    const onAuthResume = () => {
      sessionStorage.removeItem(PULLED_KEY);
      localStorage.removeItem(PULLED_AT_KEY);
      void syncWithDrive()
        .then((result) => {
          markPulled();
          applyState(result.synced ? 'synced' : 'unsynced', result.updatedAt);
          if (result.source === 'drive') router.refresh();
        })
        .catch(() => void checkSync(true));
    };
    const onAuthReset = () => {
      sessionStorage.removeItem(PULLED_KEY);
      localStorage.removeItem(PULLED_AT_KEY);
      clearSyncCache();
      setState('no-auth');
      setLastSynced(null);
    };

    window.addEventListener(SYNC_RESUME_EVENT, onAuthResume);
    window.addEventListener(SYNC_RESET_EVENT, onAuthReset);
    return () => {
      window.removeEventListener(SYNC_RESUME_EVENT, onAuthResume);
      window.removeEventListener(SYNC_RESET_EVENT, onAuthReset);
    };
  }, [applyState, checkSync, router]);

  if (state === 'no-auth') return null;

  const isSynced = state === 'synced';
  const isSyncing = state === 'syncing' || state === 'loading';

  const label = isSyncing ? '↻' : '●';
  const title = isSyncing
    ? 'Syncing with Google Drive...'
    : isSynced
    ? `Synced with Drive${lastSynced ? ' · ' + new Date(lastSynced).toLocaleTimeString() : ''}`
    : 'Not synced - click to sync now';

  return (
    <button
      onClick={!isSynced && !isSyncing ? () => void pushSync() : undefined}
      title={title}
      disabled={isSyncing}
      className={[
        'chip text-lg leading-none transition-colors',
        isSyncing ? 'text-duo-ink/30 cursor-wait' : '',
        isSynced ? 'text-duo-green border-duo-green cursor-default' : '',
        !isSynced && !isSyncing ? 'text-red-500 border-red-300 hover:bg-red-50 cursor-pointer' : '',
      ].join(' ')}
    >
      <span className={isSyncing ? 'animate-spin inline-block' : ''}>{label}</span>
    </button>
  );
}
