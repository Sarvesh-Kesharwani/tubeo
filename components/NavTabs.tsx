'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const TABS = [
  { href: '/news', label: 'News', emoji: 'NW' },
  { href: '/channels', label: 'Channels', emoji: 'CH' },
  { href: '/discover', label: 'Discover', emoji: 'SR' },
  { href: '/updates', label: 'Updates', emoji: 'AM' },
  { href: '/videos', label: 'Videos', emoji: 'WL' },
  { href: '/vocab', label: 'Vocab', emoji: 'AZ' },
];

export function NavTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();
  const [optimisticPath, setOptimisticPath] = useState(pathname);

  useEffect(() => {
    setOptimisticPath(pathname);
  }, [pathname]);

  return (
    <nav className="flex max-w-full gap-2 overflow-x-auto pb-1">
      {TABS.map((tab) => {
        const active = optimisticPath === tab.href;
        const href = qs ? `${tab.href}?${qs}` : tab.href;
        return (
          <Link
            key={tab.href}
            href={href}
            prefetch={tab.href === '/vocab' ? false : undefined}
            onClick={() => setOptimisticPath(tab.href)}
            className={`btn-duo shrink-0 px-3 sm:px-4 ${
              active
                ? 'bg-duo-green text-white shadow-duoGreen'
                : 'bg-white text-duo-ink border-2 border-duo-border shadow-card'
            }`}
          >
            <span aria-hidden>{tab.emoji}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
