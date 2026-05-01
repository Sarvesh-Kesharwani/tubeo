'use client';

import { useEffect } from 'react';
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

        window.dispatchEvent(new CustomEvent('tubeo-channels-changed', { detail: { autoSync: true } }));
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Failed to persist view preferences', error);
        }
      }
    }

    void persist();
    return () => controller.abort();
  }, [media, page, range, space]);

  return null;
}
