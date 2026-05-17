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

  const activeEntry = entries.find((entry) => entry.date === activeDate);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold uppercase tracking-wide text-duo-mute">
          Previous summaries
        </h3>

        {activeEntry && (
          <div className="flex items-center gap-2">
            {confirmDate === activeDate ? (
              <>
                <button
                  type="button"
                  className="chip bg-duo-red text-white disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void deleteSummary(activeDate)}
                  disabled={deletingDate === activeDate}
                >
                  {deletingDate === activeDate ? 'Deleting...' : 'Confirm delete'}
                </button>
                <button
                  type="button"
                  className="chip disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => setConfirmDate(null)}
                  disabled={deletingDate === activeDate}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="chip text-duo-red hover:border-duo-red hover:bg-duo-red hover:text-white"
                onClick={() => setConfirmDate(activeDate)}
              >
                Delete selected
              </button>
            )}
          </div>
        )}
      </div>

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
    </section>
  );
}
