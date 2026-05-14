'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export function AppStateTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    const lastPagePath = query ? `${pathname}?${query}` : pathname;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch('/api/app-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastPagePath }),
        signal: controller.signal,
      }).catch(() => undefined);
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pathname, searchParams]);

  return null;
}
