'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
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
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-duo-ink">
        {value.map((item, i) => (
          <li key={i}>{String(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className={depth === 0 ? 'space-y-4' : 'space-y-2'}>
        {entries.map(([key, child], i) => (
          <div key={`${key}-${i}`} className={depth === 0 ? 'card p-4 space-y-2' : 'space-y-1'}>
            <div className={depth === 0 ? 'text-base font-extrabold text-duo-blueDark' : 'text-xs font-bold uppercase tracking-wide text-duo-mute'}>
              {prettyKey(key)}
            </div>
            <RenderUnknown value={child} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return null;
}

function bulletList(items: unknown[]): React.ReactNode {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((item, i) => (
        <li key={i} className="text-sm leading-relaxed">
          {String(item)}
        </li>
      ))}
    </ul>
  );
}

function cellValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="italic text-duo-mute">-</span>;
  }
  if (Array.isArray(value)) return bulletList(value);
  if (typeof value === 'object') return <RenderUnknown value={value} depth={2} />;

  const text = String(value);
  return <span className={`whitespace-pre-wrap ${text.length > 220 ? 'text-xs leading-relaxed' : ''}`}>{text}</span>;
}

function firstDisplayValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

interface SummaryColumn {
  key: string;
  label: string;
  className?: string;
  getValue?: (row: Record<string, unknown>) => unknown;
}

function TableShell({ columns, rows }: { columns: SummaryColumn[]; rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-hidden rounded-chonk border-2 border-duo-border bg-white shadow-duo">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-gradient-to-r from-duo-green/15 via-duo-blue/10 to-duo-yellow/20">
            <tr>
              <th className="w-12 px-4 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-duo-mute">
                #
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-4 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-duo-mute ${column.className ?? ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-duo-border">
            {rows.map((row, i) => (
              <tr key={i} className="align-top transition-colors odd:bg-white even:bg-duo-soft/20 hover:bg-duo-green/10">
                <td className="px-4 py-3 font-extrabold text-duo-greenDark">{i + 1}</td>
                {columns.map((column, j) => (
                  <td key={column.key} className={`px-4 py-3 text-duo-ink ${j === 0 ? 'font-semibold' : ''}`}>
                    {cellValue(column.getValue ? column.getValue(row) : row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function objectArrayTable(rows: Array<Record<string, unknown>>, preferredColumns?: SummaryColumn[]) {
  if (rows.length === 0) return null;
  if (preferredColumns?.length) return <TableShell columns={preferredColumns} rows={rows} />;

  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8);
  if (keys.length === 0) return null;
  return (
    <TableShell
      columns={keys.map((key, index) => ({
        key,
        label: prettyKey(key),
        className: index === 0 ? 'min-w-[220px]' : '',
      }))}
      rows={rows}
    />
  );
}

function renderTable(data: Record<string, unknown>): React.ReactNode {
  if (Array.isArray(data.sections) && data.sections.length > 0) {
    return objectArrayTable(data.sections as Array<Record<string, unknown>>, [
      { key: 'topic', label: 'Topic', getValue: (row) => firstDisplayValue(row, ['heading', 'title', 'topic']) },
      { key: 'bullets', label: 'Key Points', getValue: (row) => firstDisplayValue(row, ['bullets', 'points', 'summary']) },
    ]);
  }

  if (Array.isArray(data.topics) && data.topics.length > 0) {
    const rows = data.topics as Array<Record<string, unknown>>;
    const sample = rows[0] ?? {};
    const columns: SummaryColumn[] = [];

    if ('title' in sample || 'heading' in sample || 'topic' in sample) {
      columns.push({ key: 'title', label: 'Topic', getValue: (row) => firstDisplayValue(row, ['title', 'heading', 'topic']) });
    }
    if ('why_it_matters' in sample) columns.push({ key: 'why_it_matters', label: 'Why It Matters' });
    if ('bullets' in sample || 'points' in sample) {
      columns.push({ key: 'bullets', label: 'Key Points', getValue: (row) => firstDisplayValue(row, ['bullets', 'points']) });
    }
    if ('tags' in sample) columns.push({ key: 'tags', label: 'Tags' });

    const known = new Set(columns.map((column) => column.key));
    for (const key of Object.keys(sample)) {
      if (!known.has(key)) columns.push({ key, label: prettyKey(key) });
    }
    return objectArrayTable(rows, columns.slice(0, 8));
  }

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object') {
      return (
        <div className="space-y-2">
          <h3 className="text-sm font-extrabold text-duo-blueDark">{prettyKey(key)}</h3>
          {objectArrayTable(value as Array<Record<string, unknown>>)}
        </div>
      );
    }
  }

  return null;
}

function parseJsonSummary(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fenced?.[1]) return null;
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return null;
    }
  }
}

function SummaryBody({ summary }: { summary: NewsSummaryEntry }) {
  const source = summary.data ?? parseJsonSummary(summary.raw);

  if (Array.isArray(source) && source.length > 0 && source[0] && typeof source[0] === 'object') {
    return objectArrayTable(source as Array<Record<string, unknown>>);
  }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const table = renderTable(source as Record<string, unknown>);
    if (table) return <>{table}</>;
    return <RenderUnknown value={source} />;
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
  const istDate = new Date(istMs);
  const y = istDate.getUTCFullYear();
  const m = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(istDate.getUTCDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

export function NewsSummaryCard({ initial }: { initial: NewsLoadResult }) {
  const router = useRouter();
  const [result, setResult] = useState<NewsLoadResult>(initial);
  const [selectedDate, setSelectedDate] = useState(initial.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [manualUrl, setManualUrl] = useState('');

  useEffect(() => {
    setResult(initial);
    setSelectedDate(initial.date);
    setError(null);
  }, [initial]);

  async function fetchInsights() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/summary?date=${encodeURIComponent(selectedDate)}`, {
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

  async function fetchFromUrl() {
    const url = manualUrl.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/news/summary?url=${encodeURIComponent(url)}`, {
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
      setShowUrlInput(false);
      setManualUrl('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleDateChange(value: string) {
    if (value && value !== selectedDate) {
      setSelectedDate(value);
      router.push(`/news?date=${value}`);
    }
  }

  const today = isToday(selectedDate);
  const dateLabel = today ? "Today's summary" : 'Summary';

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-extrabold text-duo-ink">{dateLabel}</h2>
            <input
              type="date"
              aria-label="Summary date"
              value={selectedDate}
              onChange={(event) => handleDateChange(event.target.value)}
              className="rounded-full border-2 border-duo-border bg-white px-3 py-1.5 text-sm font-bold text-duo-ink focus:border-duo-blue focus:outline-none"
            />
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
            <button
              type="button"
              onClick={() => setShowUrlInput((s) => !s)}
              className="ml-2 text-[11px] text-duo-mute underline transition-colors hover:text-duo-blueDark"
            >
              {showUrlInput ? 'hide' : 'paste URL'}
            </button>
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

      {showUrlInput && (
        <div className="flex gap-2">
          <input
            type="url"
            value={manualUrl}
            onChange={(event) => setManualUrl(event.target.value)}
            placeholder="https://www.insightsonindia.com/2026/05/12/upsc-current-affairs-12-may-2026/"
            className="flex-1 rounded-2xl border-2 border-duo-border bg-white px-4 py-2.5 text-sm text-duo-ink placeholder:text-duo-mute focus:border-duo-blue focus:outline-none"
            onKeyDown={(event) => event.key === 'Enter' && fetchFromUrl()}
          />
          <button
            type="button"
            className="btn-duo-green disabled:cursor-not-allowed disabled:opacity-60"
            onClick={fetchFromUrl}
            disabled={busy || !manualUrl.trim()}
          >
            {busy ? '...' : 'Fetch from URL'}
          </button>
        </div>
      )}

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
