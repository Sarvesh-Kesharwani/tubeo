'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface HistoryEntry {
  date: string;
  generatedAt: string;
  headings: string[];
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

export function NewsHistory({ activeDate }: { activeDate: string }) {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/news/history');
        const data = (await res.json()) as { ok?: boolean; dates?: HistoryEntry[] };
        if (!cancelled && data.ok && data.dates) {
          setEntries(data.dates);
        }
      } catch {
        // Silently fail — history is non-critical.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <section className="space-y-3">
        <div className="h-5 w-32 rounded bg-duo-soft animate-pulse" />
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 w-24 shrink-0 rounded-full bg-duo-soft animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (entries.length === 0) return null;

  function navigate(date: string) {
    router.push(`/news?date=${date}`);
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-extrabold text-duo-mute uppercase tracking-wide">
        Previous summaries
      </h3>

      {/* Date chips row */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {entries.map((entry) => (
          <button
            key={entry.date}
            type="button"
            onClick={() => navigate(entry.date)}
            className={`chip shrink-0 cursor-pointer text-xs font-semibold transition-colors ${
              entry.date === activeDate
                ? 'bg-duo-blue text-white'
                : 'hover:bg-duo-soft'
            }`}
          >
            {formatDate(entry.date)}
          </button>
        ))}
      </div>

      {/* Full list with heading previews */}
      <div className="space-y-2">
        {entries.map((entry) => (
          <button
            key={entry.date}
            type="button"
            onClick={() => navigate(entry.date)}
            className={`w-full text-left card p-3 sm:p-4 transition-colors cursor-pointer ${
              entry.date === activeDate
                ? 'border-duo-blue bg-duo-blue/5'
                : 'hover:bg-duo-soft/60'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-extrabold text-duo-ink">
                {formatDate(entry.date)}
              </span>
              <span className="text-[10px] text-duo-mute">
                {new Date(entry.generatedAt).toLocaleDateString()}
              </span>
            </div>
            {entry.headings.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {entry.headings.map((h, i) => (
                  <span
                    key={i}
                    className="text-[11px] text-duo-mute leading-relaxed truncate max-w-[200px]"
                  >
                    {h}{i < entry.headings.length - 1 ? ' · ' : ''}
                  </span>
                ))}
              </div>
            )}
            {entry.headings.length === 0 && (
              <p className="text-[11px] text-duo-mute italic">
                Summary available — click to view
              </p>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
