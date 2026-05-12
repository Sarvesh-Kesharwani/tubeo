'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Tab {
  label: string;
  value: string;
  count: number;
}

export function SpaceTabs({
  activeSpace,
  tabs,
}: {
  activeSpace: string;
  tabs: Tab[];
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [optimisticSpace, setOptimisticSpace] = useState(activeSpace);

  useEffect(() => {
    setOptimisticSpace(activeSpace);
  }, [activeSpace]);

  function hrefFor(space: string): string {
    const params = new URLSearchParams(sp.toString());
    if (space === 'all') {
      params.delete('space');
    } else {
      params.set('space', space);
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = tab.value === optimisticSpace;
        return (
          <Link
            key={tab.value}
            href={hrefFor(tab.value)}
            prefetch
            onClick={() => setOptimisticSpace(tab.value)}
            className={`chip ${isActive ? 'chip-active' : ''}`}
            scroll={false}
          >
            <span>{tab.label}</span>
            <span className="text-duo-ink/50">({tab.count})</span>
          </Link>
        );
      })}
    </div>
  );
}
