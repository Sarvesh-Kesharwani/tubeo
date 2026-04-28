'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type SyncState = 'loading' | 'synced' | 'unsynced' | 'syncing' | 'no-auth';

const PULLED_KEY = 'tubeo_drive_pulled';
const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>('loading');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const checkingRef = useRef(false);

  const checkSync = useCallback(async () => {
    if (syncingRef.current || checkingRef.current) return;
    checkingRef.current = true;

    try {
      const r = await fetch('/api/drive/sync');
      if (r.status === 401) { setState('no-auth'); return; }
      if (!r.ok) { setState('unsynced'); return; }
      const data = await r.json();
      setState(data.synced ? 'synced' : 'unsynced');
      if (data.updatedAt) {
        setLastSynced(data.updatedAt);
      } else {
        setLastSynced(null);
      }
    } catch {
      setState('unsynced');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const pushSync = useCallback(async (background = false) => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    if (!background) {
      setState('syncing');
    }

    try {
      const r = await fetch('/api/drive/sync', { method: 'POST' });
      if (r.status === 401) { setState('no-auth'); return; }
      if (!r.ok) { setState('unsynced'); return; }
      const data = await r.json();
      if (data.initialized || data.driveWins || data.seededFromLocal) {
        sessionStorage.setItem(PULLED_KEY, '1');
        setLastSynced(data.updatedAt ?? new Date().toISOString());
        setState('synced');
        if (data.replacedLocal || data.seededFromLocal) {
          router.refresh();
        }
        return;
      }
      setLastSynced(data.updatedAt ?? new Date().toISOString());
      setState('synced');
    } catch {
      setState('unsynced');
    } finally {
      syncingRef.current = false;
    }
  }, [router]);

  // On mount: pull Drive -> cookie only once per login session.
  useEffect(() => {
    if (sessionStorage.getItem(PULLED_KEY)) {
      void checkSync();
      return;
    }

    fetch('/api/drive/sync', { method: 'PUT' })
      .then((r) => {
        if (r.status === 401) { setState('no-auth'); return; }
        if (!r.ok) { setState('unsynced'); return; }
        sessionStorage.setItem(PULLED_KEY, '1');
        void checkSync();
        router.refresh();
      })
      .catch(() => void checkSync());
  }, [checkSync, router]);

  useEffect(() => {
    const onChannelsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ autoSync?: boolean }>).detail;
      setLastSynced(null);
      setState('unsynced');

      if (detail?.autoSync) {
        void pushSync(true);
      } else {
        void checkSync();
      }
    };

    window.addEventListener(CHANNELS_CHANGED_EVENT, onChannelsChanged);
    return () => window.removeEventListener(CHANNELS_CHANGED_EVENT, onChannelsChanged);
  }, [checkSync, pushSync]);

  // Poll every 30s — keep polling in no-auth so token refresh recovers automatically
  useEffect(() => {
    const id = setInterval(() => void checkSync(), 30_000);
    return () => clearInterval(id);
  }, [checkSync]);

  useEffect(() => {
    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      if (state === 'no-auth') sessionStorage.removeItem(PULLED_KEY);
      void checkSync();
    };

    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [checkSync, state]);

  if (state === 'no-auth') return null;

  const isSynced = state === 'synced';
  const isSyncing = state === 'syncing' || state === 'loading';

  const label = isSyncing ? '↻' : isSynced ? '●' : '●';
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
