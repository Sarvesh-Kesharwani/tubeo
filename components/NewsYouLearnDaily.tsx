'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { NewsYouLearnState, NewsYouLearnVideo, NewsYouLearnVideoSummary } from '@/lib/types';

function pickDaily(videos: NewsYouLearnVideo[], date: string): NewsYouLearnVideo | null {
  if (videos.length === 0) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  const days = Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
  return videos[Math.abs(days) % videos.length] ?? null;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}:${String(secs).padStart(2, '0')}`;
  const hours = Math.floor(mins / 60);
  return `${hours}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
}

function parseRawJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function titleFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function primitiveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function GenericValue({ value }: { value: unknown }) {
  const text = primitiveText(value);
  if (text) {
    return <p className="text-sm font-semibold leading-relaxed text-duo-ink">{text}</p>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return (
      <ul className="space-y-2">
        {value.slice(0, 16).map((item, index) => {
          const itemText = primitiveText(item);
          return (
            <li key={index} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink shadow-sm">
              {itemText || <GenericValue value={item} />}
            </li>
          );
        })}
      </ul>
    );
  }

  if (value && typeof value === 'object') {
    return (
      <div className="space-y-3">
        {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
          <div key={key} className="rounded-2xl border-2 border-duo-border bg-white/80 p-3">
            <h5 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-duo-blueDark">
              {titleFromKey(key)}
            </h5>
            <GenericValue value={child} />
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function GenericSummary({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      {entries.slice(0, 12).map(([key, value], index) => (
        <section
          key={key}
          className={`rounded-3xl border-2 border-duo-border p-4 shadow-card ${
            index % 3 === 0 ? 'bg-duo-green/10' : index % 3 === 1 ? 'bg-duo-yellow/20' : 'bg-white'
          }`}
        >
          <h4 className="mb-3 text-sm font-extrabold text-duo-ink">{titleFromKey(key)}</h4>
          <GenericValue value={value} />
        </section>
      ))}
    </div>
  );
}

function SummaryBlock({ summary }: { summary: NewsYouLearnVideoSummary }) {
  const data = summary.data && typeof summary.data === 'object' ? summary.data : parseRawJson(summary.raw);
  if (!data || typeof data !== 'object') {
    return (
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-2xl border-2 border-duo-border bg-duo-soft/50 p-3 text-xs leading-relaxed text-duo-ink">
        {summary.raw}
      </pre>
    );
  }

  const obj = data as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title : summary.videoTitle;
  const keyPoints = normalizeList(obj.key_points ?? obj.keyPoints ?? obj.summary);
  const impacts = normalizeList(obj.why_it_matters ?? obj.whyItMatters ?? obj.impact);
  const notes = normalizeList(obj.revision_notes ?? obj.revisionNotes ?? obj.notes);
  const terms = Array.isArray(obj.terms) ? obj.terms.slice(0, 8) : [];
  const knownKeys = new Set([
    'title',
    'key_points',
    'keyPoints',
    'summary',
    'why_it_matters',
    'whyItMatters',
    'impact',
    'revision_notes',
    'revisionNotes',
    'notes',
    'terms',
  ]);
  const extraData = Object.fromEntries(Object.entries(obj).filter(([key]) => !knownKeys.has(key)));

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border-2 border-duo-border bg-white p-4 shadow-card">
        <p className="text-xs font-extrabold uppercase tracking-wide text-duo-greenDark">Processed notes</p>
        <h3 className="mt-1 text-lg font-extrabold leading-tight text-duo-ink">{title}</h3>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {keyPoints.length > 0 && (
          <section className="rounded-3xl border-2 border-duo-border bg-duo-green/10 p-4">
            <h4 className="mb-2 text-sm font-extrabold text-duo-greenDark">Key points</h4>
            <ul className="space-y-2">
              {keyPoints.map((point, i) => (
                <li key={i} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        )}

        {impacts.length > 0 && (
          <section className="rounded-3xl border-2 border-duo-border bg-duo-yellow/20 p-4">
            <h4 className="mb-2 text-sm font-extrabold text-duo-blueDark">Why it matters</h4>
            <ul className="space-y-2">
              {impacts.map((point, i) => (
                <li key={i} className="rounded-2xl bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-duo-ink">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {terms.length > 0 && (
        <section className="rounded-3xl border-2 border-duo-border bg-duo-soft/60 p-4">
          <h4 className="mb-2 text-sm font-extrabold text-duo-blueDark">Terms</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {terms.map((term, i) => {
              const item = term && typeof term === 'object' ? (term as Record<string, unknown>) : {};
              return (
                <div key={i} className="rounded-2xl bg-white px-3 py-2">
                  <div className="text-xs font-extrabold text-duo-blueDark">{String(item.term ?? `Term ${i + 1}`)}</div>
                  <div className="mt-1 text-sm leading-relaxed text-duo-ink">{String(item.meaning ?? term)}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="rounded-3xl border-2 border-duo-border bg-white p-4 shadow-card">
          <h4 className="mb-2 text-sm font-extrabold text-duo-blueDark">Revision notes</h4>
          <ol className="list-decimal space-y-1 pl-5 text-sm font-semibold leading-relaxed text-duo-ink">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ol>
        </section>
      )}

      {Object.keys(extraData).length > 0 && <GenericSummary data={extraData} />}
    </div>
  );
}

export function NewsYouLearnDaily({
  initialState,
  date,
}: {
  initialState: NewsYouLearnState;
  date: string;
}) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState<'process' | 'force' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dailyVideo = useMemo(() => pickDaily(state.videos, date), [state.videos, date]);
  const summary = dailyVideo ? state.summaries[date] : null;

  async function processVideo(force = false) {
    setBusy(force ? 'force' : 'process');
    setError(null);
    try {
      const res = await fetch('/api/news/youlearn/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, force }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; error?: string };
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Processing failed.');
      setState(data.state);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function markCompleted(videoId: string) {
    setBusy('complete');
    setError(null);
    try {
      const res = await fetch('/api/news/youlearn/videos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, completed: true }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; error?: string };
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Could not mark completed.');
      setState(data.state);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-duo-ink">Daily YouLearn video</h2>
          <p className="mt-1 text-sm text-duo-mute">
            Import a public YouLearn space. Tubeo shows one video per day and processes its transcript with your settings prompt.
          </p>
        </div>
        <Link href="/settings" className="btn-duo bg-white text-duo-blueDark shadow-card">
          Manage list
        </Link>
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-duo-mute">
          <span className="chip cursor-default">{state.videos.length} videos</span>
          {state.importedAt !== new Date(0).toISOString() && (
            <span className="chip cursor-default">Imported {new Date(state.importedAt).toLocaleString()}</span>
          )}
          {!state.prompt.trim() && <span className="chip cursor-default text-duo-blueDark">Using default prompt</span>}
        </div>

        {error && (
          <div className="rounded-2xl border-2 border-duo-red bg-white px-4 py-3 text-sm font-bold text-duo-red">
            {error}
          </div>
        )}
      </div>

      {dailyVideo ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
          <article className="card overflow-hidden">
            <video
              controls
              preload="metadata"
              poster={dailyVideo.thumbnail}
              src={dailyVideo.url}
              className="aspect-video w-full bg-duo-ink object-cover"
            />
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                <span className="chip cursor-default">Today</span>
                {dailyVideo.durationSec > 0 && <span className="chip cursor-default">{formatDuration(dailyVideo.durationSec)}</span>}
                {dailyVideo.completedAt && (
                  <span className="chip cursor-default text-duo-greenDark">
                    Completed {new Date(dailyVideo.completedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <h3 className="text-base font-extrabold leading-tight text-duo-ink">{dailyVideo.title}</h3>
              <div className="flex flex-wrap gap-2">
                <a href={dailyVideo.url} target="_blank" rel="noreferrer" className="chip">
                  Open video
                </a>
                <button
                  type="button"
                  className="btn-duo bg-duo-blue text-white shadow-duoBlue disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => processVideo(Boolean(summary))}
                  disabled={busy !== null}
                >
                  {busy === 'process' || busy === 'force' ? 'Processing...' : summary ? 'Refresh notes' : 'Process transcript'}
                </button>
                <button
                  type="button"
                  className="btn-duo bg-duo-green text-white shadow-duoGreen disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => markCompleted(dailyVideo.id)}
                  disabled={busy !== null}
                >
                  {busy === 'complete' ? 'Saving...' : dailyVideo.completedAt ? 'Update completed' : 'Mark completed'}
                </button>
              </div>
            </div>
          </article>

          <div className="min-w-0">
            {summary ? (
              <SummaryBlock summary={summary} />
            ) : (
              <div className="card flex min-h-[260px] flex-col items-start justify-center gap-3 p-5">
                <h3 className="text-lg font-extrabold text-duo-ink">Transcript not processed yet</h3>
                <p className="text-sm font-semibold leading-relaxed text-duo-mute">
                  Click process once. Tubeo fetches YouLearn transcript, sends it to DeepSeek, then saves the result for this date.
                </p>
                <button
                  type="button"
                  className="btn-duo bg-duo-blue text-white shadow-duoBlue disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => processVideo(false)}
                  disabled={busy !== null}
                >
                  {busy === 'process' ? 'Processing...' : 'Process transcript'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-6 text-sm font-bold text-duo-mute">
          No YouLearn videos imported yet. Open settings to import a public YouLearn space, folder, or playlist.
        </div>
      )}
    </section>
  );
}
