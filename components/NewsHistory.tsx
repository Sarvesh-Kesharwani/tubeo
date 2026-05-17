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
  const [deletingDate, setDeletingDate] = useState<string | null>(null);
  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        // History is non-critical.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
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

  async function deleteSummary(date: string) {
    setDeletingDate(date);
    setError(null);
    try {
      const res = await fetch(`/api/news/summary?date=${encodeURIComponent(date)}`, {
        method: 'DELETE',
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      setEntries((current) => current.filter((entry) => entry.date !== date));
      setConfirmDate(null);
      if (date === activeDate) {
        router.push('/news');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingDate(null);
    }
  }

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-duo-mute">
        Previous summaries
      </h3>

      {error && (
        <div className="rounded-chonk border-2 border-duo-red bg-white px-4 py-3 text-sm font-semibold text-duo-red">
          {error}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {entries.map((entry) => (
          <button
            key={entry.date}
            type="button"
            onClick={() => navigate(entry.date)}
            className={`chip shrink-0 cursor-pointer text-xs font-semibold transition-colors ${
              entry.date === activeDate ? 'bg-duo-blue text-white' : 'hover:bg-duo-soft'
            }`}
          >
            {formatDate(entry.date)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.date}
            className={`card p-3 text-left transition-colors sm:p-4 ${
              entry.date === activeDate ? 'border-duo-blue bg-duo-blue/5' : 'hover:bg-duo-soft/60'
            }`}
          >
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => navigate(entry.date)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="text-sm font-extrabold text-duo-ink">
                  {formatDate(entry.date)}
                </span>
                <span className="ml-2 text-[10px] text-duo-mute">
                  {new Date(entry.generatedAt).toLocaleDateString()}
                </span>
              </button>

              {confirmDate === entry.date ? (
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="chip bg-duo-red text-white disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void deleteSummary(entry.date)}
                    disabled={deletingDate === entry.date}
                  >
                    {deletingDate === entry.date ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    className="chip disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => setConfirmDate(null)}
                    disabled={deletingDate === entry.date}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="chip shrink-0 text-duo-red hover:border-duo-red hover:bg-duo-red hover:text-white"
                  onClick={() => setConfirmDate(entry.date)}
                >
                  Delete
                </button>
              )}
            </div>

            <button type="button" className="block w-full text-left" onClick={() => navigate(entry.date)}>
              {entry.headings.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {entry.headings.map((heading, i) => (
                    <span
                      key={i}
                      className="max-w-[200px] truncate text-[11px] leading-relaxed text-duo-mute"
                    >
                      {heading}
                      {i < entry.headings.length - 1 ? ' - ' : ''}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] italic text-duo-mute">
                  Summary available - click to view
                </p>
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
