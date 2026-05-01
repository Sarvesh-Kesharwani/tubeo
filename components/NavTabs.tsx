'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Mixed', emoji: 'TV' },
  { href: '/channels', label: 'Channels', emoji: 'CH' },
  { href: '/updates', label: 'Updates', emoji: 'AM' },
  { href: '/videos', label: 'Videos', emoji: 'WL' },
];

export function NavTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();

  return (
    <nav className="flex max-w-full gap-2 overflow-x-auto pb-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const href = qs ? `${tab.href}?${qs}` : tab.href;
        return (
          <Link
            key={tab.href}
            href={href}
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
