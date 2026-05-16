'use client';

import { useEffect, useState } from 'react';
import { UsageProgressBar } from '@/components/UsageProgressBar';
import type { ApiUsageSummary } from '@/lib/types';

function formatUnits(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function HeaderQuotaBar() {
  const [youtube, setYoutube] = useState<ApiUsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/quota/track', { cache: 'no-store' });
        if (!response.ok) {
          if (!cancelled) setYoutube(null);
          return;
        }
        const data = (await response.json()) as { youtube?: ApiUsageSummary };
        if (!cancelled) setYoutube(data.youtube ?? null);
      } catch {
        if (!cancelled) setYoutube(null);
      }
    }

    void load();
    window.addEventListener('tubeo-quota-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('tubeo-quota-updated', load);
    };
  }, []);

  if (!youtube) return null;

  return (
    <div className="hidden min-w-[140px] max-w-[190px] flex-1 sm:block" title="YouTube API quota used today">
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wide text-duo-ink/55">
        <span>YT API</span>
        <span>
          {formatUnits(youtube.usedToday)}/{formatUnits(youtube.dailyLimit)}
        </span>
      </div>
      <UsageProgressBar
        compact
        dailyLimit={youtube.dailyLimit}
        usedToday={youtube.usedToday}
        operations={youtube.operations}
      />
    </div>
  );
}
