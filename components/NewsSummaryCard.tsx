'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NewsLoadResult } from '@/lib/news-service';
import type { NewsSummaryEntry } from '@/lib/supabase-news';

function prettyKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function RenderUnknown({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-duo-ink">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p className="text-sm leading-relaxed text-duo-ink">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    const allScalar = value.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
    if (allScalar) {
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-duo-ink">
          {value.map((item, i) => (
            <li key={i}>{String(item)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className={depth >= 1 ? 'space-y-2' : 'space-y-3'}>
        {value.map((item, i) => (
          <RenderUnknown key={i} value={item} depth={depth + 1} />
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className={depth === 0 ? 'space-y-4' : 'space-y-2'}>
        {entries.map(([key, child], i) => {
          const headingClass =
            depth === 0
              ? 'text-base font-extrabold text-duo-blueDark'
              : depth === 1
                ? 'text-sm font-bold text-duo-ink'
                : 'text-xs font-bold uppercase tracking-wide text-duo-mute';
          return (
            <div key={`${key}-${i}`} className={depth === 0 ? 'card p-4 space-y-2' : 'space-y-1'}>
              <div className={headingClass}>{prettyKey(key)}</div>
              <RenderUnknown value={child} depth={depth + 1} />
            </div>
          );
        })}
      </div>
    );
  }
  return null;
}

function SummaryBody({ summary }: { summary: NewsSummaryEntry }) {
  if (summary.data && (typeof summary.data === 'object' || Array.isArray(summary.data))) {
    return <RenderUnknown value={summary.data} />;
  }
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border-2 border-duo-border bg-duo-soft/40 p-3 text-xs leading-relaxed text-duo-ink">
      {summary.raw || 'No summary content.'}
    </pre>
  );
}

function StatusBanner({ result }: { result: NewsLoadResult }) {
  const messages: Record<typeof result.status, string> = {
    ok: '',
    ready: "Prompt is ready. Click Fetch today's Insights to fetch the page HTML and generate the summary.",
    'no-config':
      'News Supabase tables are not configured. Add TUBEO_SUPABASE_URL and news access env vars, then run docs/supabase-news-schema.sql.',
    'no-html-yet': "Today's InsightsOnIndia page is not available yet. Try Fetch today's Insights again after it publishes.",
    'no-prompt': "Set a DeepSeek prompt from the Prompt button, then fetch today's Insights.",
    'deepseek-failed': result.error || 'DeepSeek call failed. Try again in a minute.',
    'fetch-failed': result.error || 'Failed to fetch the source page.',
  };
  const message = messages[result.status];
  if (!message) return null;
  return (
    <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/50 px-4 py-3 text-sm font-semibold text-duo-mute">
      {message}
    </div>
  );
}

function isToday(dateStr: string): boolean {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const y = new Date(istMs).getUTCFullYear();
  const m = String(new Date(istMs).getUTCMonth() + 1).padStart(2, '0');
  const d = String(new Date(istMs).getUTCDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

export function NewsSummaryCard({ initial }: { initial: NewsLoadResult }) {
  const router = useRouter();
  const pickerRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<NewsLoadResult>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setResult(initial);
    setError(null);
  }, [initial]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPicker]);

  async function fetchInsights() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/summary?date=${encodeURIComponent(result.date)}`, {
        method: 'POST',
      });
      const data = (await res.json()) as { ok?: boolean; error?: string } & NewsLoadResult;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Fetch failed (${res.status})`);
      }
      setResult({
        date: data.date,
        sourceUrl: data.sourceUrl,
        status: data.status,
        summary: data.summary,
        rawFetchedAt: data.rawFetchedAt,
        error: data.error,
        regenerated: data.regenerated,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleDateChange(value: string) {
    setShowPicker(false);
    if (value && value !== result.date) {
      router.push(`/news?date=${value}`);
    }
  }

  const today = isToday(result.date);
  const dateLabel = today ? `Today's summary · ${result.date}` : `Summary · ${result.date}`;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="relative inline-block" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setShowPicker((s) => !s)}
              className="flex items-center gap-1.5 text-lg font-extrabold text-duo-ink hover:text-duo-blueDark transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              {dateLabel}
              <svg className="w-4 h-4 text-duo-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            {showPicker && (
              <div className="absolute z-20 top-full left-0 mt-2 rounded-2xl border-2 border-duo-border bg-white p-3 shadow-lg">
                <input
                  type="date"
                  value={result.date}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="rounded-xl border-2 border-duo-border bg-white px-3 py-2 text-sm font-semibold text-duo-ink focus:border-duo-blue focus:outline-none"
                  autoFocus
                />
              </div>
            )}
          </div>
          <p className="text-xs text-duo-mute">
            Source:{' '}
            <a
              href={result.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-duo-blueDark hover:underline"
            >
              insightsonindia.com
            </a>
            {result.summary && (
              <span className="ml-2">
                {' '}
                - generated {new Date(result.summary.generatedAt).toLocaleString()}
                {result.summary.usedUserPrompt ? '' : ' (default prompt)'}
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          className="btn-duo-green disabled:cursor-not-allowed disabled:opacity-60"
          onClick={fetchInsights}
          disabled={busy || result.status === 'no-config'}
        >
          {busy ? 'Fetching...' : today ? "Fetch today's Insights" : 'Fetch Insights'}
        </button>
      </header>

      {error && (
        <div className="rounded-chonk border-2 border-duo-red bg-white px-4 py-3 text-sm font-semibold text-duo-red">
          {error}
        </div>
      )}

      <StatusBanner result={result} />

      {result.summary && <SummaryBody summary={result.summary} />}
    </section>
  );
}
