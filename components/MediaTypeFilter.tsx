'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { saveState } from '@/lib/filter-persistence';
import { MEDIA_FILTERS } from '@/lib/media';
import type { MediaFilter, TimeRange } from '@/lib/types';

export function MediaTypeFilter({ active }: { active: MediaFilter }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [optimisticMedia, setOptimisticMedia] = useState(active);

  useEffect(() => {
    setOptimisticMedia(active);
  }, [active]);

  function hrefFor(media: MediaFilter): string {
    const params = new URLSearchParams(sp.toString());
    if (media === 'all') {
      params.delete('media');
    } else {
      params.set('media', media);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function persistMedia(media: MediaFilter) {
    const page = pathname === '/channels' ? 'channels' : pathname === '/updates' ? 'updates' : 'home';
    const range = (sp.get('range') ?? '7d') as TimeRange;
    const space = sp.get('space') ?? undefined;
    const filters =
      page === 'channels'
        ? { channels: { range, media, space: space ?? 'all' } }
        : page === 'updates'
        ? { updates: { range, media } }
        : { home: { range, media } };

    saveState(filters);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {MEDIA_FILTERS.map((filter) => {
        const isActive = filter.value === optimisticMedia;
        return (
          <Link
            key={filter.value}
            href={hrefFor(filter.value)}
            prefetch
            onClick={() => {
              setOptimisticMedia(filter.value);
              persistMedia(filter.value);
            }}
            className={`chip ${isActive ? 'chip-active' : ''}`}
            scroll={false}
          >
            <span>{filter.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
