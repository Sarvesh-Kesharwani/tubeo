'use client';

import { useState } from 'react';
import type { NewsYouLearnState } from '@/lib/types';

function formatDuration(seconds: number): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}:${String(secs).padStart(2, '0')}`;
  const hours = Math.floor(mins / 60);
  return `${hours}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function isCompletedOverOneWeek(completedAt?: string): boolean {
  if (!completedAt) return false;
  const parsed = Date.parse(completedAt);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed > 7 * 24 * 60 * 60 * 1000;
}

export function NewsYouLearnLibrarySettings({
  initialState,
  target = 'youlearn',
  title = 'Daily UPSC Videos',
}: {
  initialState: NewsYouLearnState;
  target?: 'youlearn' | 'clipwise';
  title?: string;
}) {
  const [state, setState] = useState(initialState);
  const list = target === 'clipwise' ? state.clipwiseVideos ?? [] : state.videos;
  const importedAt = target === 'clipwise' ? state.clipwiseImportedAt : state.importedAt;
  const [sourceUrl, setSourceUrl] = useState(
    target === 'clipwise' ? initialState.clipwiseSourceUrl ?? '' : initialState.sourceUrl,
  );
  const [busy, setBusy] = useState<'import' | 'clear' | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function importSource() {
    setBusy('import');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/news/youlearn/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl, target }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; error?: string };
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Import failed.');
      setState(data.state);
      setSourceUrl(target === 'clipwise' ? data.state.clipwiseSourceUrl ?? '' : data.state.sourceUrl);
      const nextList = target === 'clipwise' ? data.state.clipwiseVideos ?? [] : data.state.videos;
      setMessage(`Imported list now has ${nextList.length} videos.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function updateList(payload: { videoId?: string; clear?: true }) {
    const busyKey = payload.clear ? 'clear' : payload.videoId ?? null;
    setBusy(busyKey);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/news/youlearn/videos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, target }),
      });
      const data = (await res.json()) as { ok?: boolean; state?: NewsYouLearnState; error?: string };
      if (!res.ok || !data.ok || !data.state) throw new Error(data.error || 'Update failed.');
      setState(data.state);
      setMessage(payload.clear ? 'List cleared.' : 'Video removed.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-extrabold text-duo-ink">{title}</h2>
        <span className="chip cursor-default text-[11px]">{list.length} videos</span>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row">
        <input
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="Paste YouLearn space, folder, or playlist link"
          className="min-w-0 flex-1 rounded-2xl border-2 border-duo-border px-4 py-3 text-sm font-semibold text-duo-ink outline-none focus:border-duo-blue"
        />
        <button
          type="button"
          className="btn-duo bg-duo-green text-white shadow-duoGreen disabled:cursor-not-allowed disabled:opacity-60"
          onClick={importSource}
          disabled={busy !== null || !sourceUrl.trim()}
        >
          {busy === 'import' ? 'Importing...' : 'Import videos'}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-duo-mute">
          {importedAt && importedAt !== new Date(0).toISOString() && (
            <span className="chip cursor-default">Last import {new Date(importedAt).toLocaleString()}</span>
          )}
          {message && <span className="chip cursor-default text-duo-greenDark">{message}</span>}
          {error && <span className="chip cursor-default text-duo-red">{error}</span>}
        </div>
        <button
          type="button"
          className="chip border-duo-red text-duo-red disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            if (window.confirm('Clear all imported YouLearn videos from Tubeo?')) {
              void updateList({ clear: true });
            }
          }}
          disabled={busy !== null || list.length === 0}
        >
          {busy === 'clear' ? 'Clearing...' : 'Clear list'}
        </button>
      </div>

      {list.length > 0 ? (
        <details className="rounded-2xl border-2 border-duo-border bg-duo-soft/40 p-3">
          <summary className="cursor-pointer text-sm font-extrabold text-duo-ink">
            Manage imported videos
          </summary>
          <div className="mt-3 max-h-[300px] space-y-2 overflow-auto pr-1">
            {list.map((video) => {
              const staleCompleted = isCompletedOverOneWeek(video.completedAt);
              return (
                <article
                  key={video.id}
                  className={`flex gap-3 rounded-2xl border-2 p-2 shadow-card ${
                    staleCompleted
                      ? 'border-duo-red bg-duo-red/10'
                      : 'border-duo-border bg-white'
                  }`}
                >
                  {video.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={video.thumbnail} alt="" className="h-12 w-16 rounded-xl object-cover" />
                  ) : (
                    <div className="h-12 w-16 rounded-xl bg-duo-soft" />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-extrabold leading-snug text-duo-ink">{video.title}</h3>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-extrabold text-duo-mute">
                      {video.durationSec > 0 && <span className="chip cursor-default">{formatDuration(video.durationSec)}</span>}
                      {video.contentId && <span className="chip cursor-default">Transcript</span>}
                      {video.completedAt && (
                        <span className={`chip cursor-default ${staleCompleted ? 'border-duo-red text-duo-red' : 'text-duo-greenDark'}`}>
                          {staleCompleted ? 'Old complete' : `Done ${new Date(video.completedAt).toLocaleDateString()}`}
                        </span>
                      )}
                      <a href={video.url} target="_blank" rel="noreferrer" className="chip">
                        Open
                      </a>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="chip h-fit border-duo-red text-duo-red disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => updateList({ videoId: video.id })}
                    disabled={busy !== null}
                  >
                    {busy === video.id ? '...' : 'Remove'}
                  </button>
                </article>
              );
            })}
          </div>
        </details>
      ) : (
        <div className="rounded-2xl border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-3 text-sm font-bold text-duo-mute">
          No videos imported yet.
        </div>
      )}
    </section>
  );
}
