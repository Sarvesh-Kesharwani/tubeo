'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { TIME_RANGES } from '@/lib/time';
import type { TimeRange } from '@/lib/types';

export function TimeFilter({ active }: { active: TimeRange }) {
  const pathname = usePathname();
  const sp = useSearchParams();

  function hrefFor(r: TimeRange): string {
    const params = new URLSearchParams(sp.toString());
    params.set('range', r);
    return `${pathname}?${params.toString()}`;
  }

  function persistRange(range: TimeRange) {
    const page = pathname === '/channels' ? 'channels' : pathname === '/updates' ? 'updates' : 'home';
    const media = sp.get('media') ?? 'all';
    const space = sp.get('space') ?? undefined;

    void fetch('/api/view-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, range, media, space }),
    }).then((response) => {
      if (response.ok) {
        window.dispatchEvent(new CustomEvent('tubeo-channels-changed', { detail: { autoSync: true } }));
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TIME_RANGES.map((r) => {
        const isActive = r.value === active;
        return (
          <Link
            key={r.value}
            href={hrefFor(r.value)}
            onClick={() => persistRange(r.value)}
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
