'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { saveState } from '@/lib/filter-persistence';
import { TIME_RANGES } from '@/lib/time';
import type { DurationFilter, MediaFilter, TimeRange } from '@/lib/types';

export function TimeFilter({ active }: { active: TimeRange }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [optimisticRange, setOptimisticRange] = useState(active);

  useEffect(() => {
    setOptimisticRange(active);
  }, [active]);

  function hrefFor(r: TimeRange): string {
    const params = new URLSearchParams(sp.toString());
    params.set('range', r);
    return `${pathname}?${params.toString()}`;
  }

  function persistRange(range: TimeRange) {
    const page = pathname === '/channels' ? 'channels' : pathname === '/updates' ? 'updates' : 'home';
    const media = (sp.get('media') ?? 'all') as MediaFilter;
    const duration = (sp.get('duration') ?? 'all') as DurationFilter;
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
      {TIME_RANGES.map((r) => {
        const isActive = r.value === optimisticRange;
        return (
          <Link
            key={r.value}
            href={hrefFor(r.value)}
            prefetch
            onClick={() => {
              setOptimisticRange(r.value);
              persistRange(r.value);
            }}
            className={`chip ${isActive ? 'chip-active' : ''}`}
            scroll={false}
          >
            <span aria-hidden>{r.emoji}</span>
            <span>{r.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
