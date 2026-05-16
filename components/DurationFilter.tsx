'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DURATION_FILTERS } from '@/lib/duration';
import { saveState } from '@/lib/filter-persistence';
import type { DurationFilter as DurationFilterValue, MediaFilter, TimeRange } from '@/lib/types';

export function DurationFilter({ active }: { active: DurationFilterValue }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [optimisticDuration, setOptimisticDuration] = useState(active);

  useEffect(() => {
    setOptimisticDuration(active);
  }, [active]);

  function hrefFor(duration: DurationFilterValue): string {
    const params = new URLSearchParams(sp.toString());
    if (duration === 'all') {
      params.delete('duration');
    } else {
      params.set('duration', duration);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function persistDuration(duration: DurationFilterValue) {
    const page = pathname === '/channels' ? 'channels' : pathname === '/updates' ? 'updates' : 'home';
    const range = (sp.get('range') ?? '7d') as TimeRange;
    const media = (sp.get('media') ?? 'all') as MediaFilter;
    const space = sp.get('space') ?? undefined;
    const filters =
      page === 'channels'
        ? { channels: { range, media, duration, space: space ?? 'all' } }
        : page === 'updates'
        ? { updates: { range, media, duration } }
        : { home: { range, media, duration } };

    saveState(filters);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {DURATION_FILTERS.map((filter) => {
        const isActive = filter.value === optimisticDuration;
        return (
          <Link
            key={filter.value}
            href={hrefFor(filter.value)}
            prefetch
            onClick={() => {
              setOptimisticDuration(filter.value);
              persistDuration(filter.value);
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
