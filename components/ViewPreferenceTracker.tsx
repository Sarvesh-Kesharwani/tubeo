'use client';

import { useEffect } from 'react';
import { saveState } from '@/lib/filter-persistence';
import type { MediaFilter, TimeRange } from '@/lib/types';

export function ViewPreferenceTracker({
  page,
  range,
  media,
  space,
}: {
  page: 'home' | 'channels' | 'updates';
  range: TimeRange;
  media: MediaFilter;
  space?: string;
}) {
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void persist();
    }, 350);
    const filters =
      page === 'channels'
        ? { channels: { range, media, space: space ?? 'all' } }
        : page === 'updates'
        ? { updates: { range, media } }
        : { home: { range, media } };
    saveState(filters);

    async function persist() {
      try {
        const res = await fetch('/api/view-preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page, range, media, space }),
          signal: controller.signal,
        });

        if (!res.ok) return;
        const data = (await res.json()) as { changed?: boolean };
        if (!data.changed) return;

        window.dispatchEvent(
          new CustomEvent('tubeo-channels-changed', {
            detail: { autoSync: true, debounceMs: 1_500 },
          }),
        );
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Failed to persist view preferences', error);
        }
      }
    }

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [media, page, range, space]);

  return null;
}
