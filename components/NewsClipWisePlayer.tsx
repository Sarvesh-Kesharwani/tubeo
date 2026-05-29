'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NewsClipWiseProgress, NewsYouLearnState, NewsYouLearnVideo } from '@/lib/types';

const CLIP_SECONDS = 120;

type ProgressStore = Record<string, NewsClipWiseProgress>;

function pickDaily(videos: NewsYouLearnVideo[], date: string): NewsYouLearnVideo | null {
  if (videos.length === 0) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  const days = Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
  return videos[Math.abs(days) % videos.length] ?? null;
}

function progressKey(videoId: string): string {
  return `${videoId}:${CLIP_SECONDS}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) return `${mins}:${String(secs).padStart(2, '0')}`;
  const hours = Math.floor(mins / 60);
  return `${hours}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function clipCount(duration: number): number {
  return Math.max(1, Math.ceil(Math.max(duration, CLIP_SECONDS) / CLIP_SECONDS));
}

function clipBounds(index: number, duration: number) {
  const safeDuration = Math.max(duration, CLIP_SECONDS);
  const start = index * CLIP_SECONDS;
  const end = Math.min((index + 1) * CLIP_SECONDS, safeDuration);
  return { start, end, duration: Math.max(1, end - start) };
}

export function NewsClipWisePlayer({
  initialState,
  date,
}: {
  initialState: NewsYouLearnState;
  date: string;
}) {
  const videos = useMemo(
    () => (initialState.clipwiseVideos?.length ? initialState.clipwiseVideos : []),
    [initialState.clipwiseVideos],
  );
  const dailyVideo = useMemo(() => pickDaily(videos, date), [videos, date]);
  const [selectedVideoId, setSelectedVideoId] = useState(
    dailyVideo?.id || videos[0]?.id || '',
  );
  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) ?? dailyVideo,
    [dailyVideo, selectedVideoId, videos],
  );
  const [progress, setProgress] = useState<ProgressStore>(initialState.clipwiseProgress ?? {});
  const [duration, setDuration] = useState(selectedVideo?.durationSec || 0);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setProgress(initialState.clipwiseProgress ?? {});
  }, [initialState.clipwiseProgress]);

  useEffect(() => {
    if (!selectedVideo) return;
    const key = progressKey(selectedVideo.id);
    setDuration(selectedVideo.durationSec || 0);
    setActiveClipIndex(progress[key]?.lastClipIndex ?? 0);
    setCurrentTime(clipBounds(progress[key]?.lastClipIndex ?? 0, selectedVideo.durationSec || CLIP_SECONDS).start);
    setStatus(null);
  }, [progress, selectedVideo]);

  if (!selectedVideo) {
    return (
      <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-6 text-sm font-bold text-duo-mute">
        No ClipWise videos imported yet.
      </div>
    );
  }

  const video = selectedVideo;
  const key = progressKey(video.id);
  const saved = progress[key] ?? {
    videoId: video.id,
    clipSeconds: CLIP_SECONDS,
    done: [],
    lastClipIndex: 0,
    updatedAt: new Date(0).toISOString(),
  };
  const done = new Set(saved.done);
  const totalClips = clipCount(duration || video.durationSec);
  const activeClip = Math.min(activeClipIndex, totalClips - 1);
  const bounds = clipBounds(activeClip, duration || video.durationSec);
  const doneCount = done.size;
  const pct = Math.round((doneCount / totalClips) * 100);

  function clipProgressPercent(index: number): number {
    if (done.has(index)) return 100;
    if (index !== activeClip) return 0;
    const itemBounds = clipBounds(index, duration || video.durationSec);
    return Math.max(0, Math.min(100, Math.round(((currentTime - itemBounds.start) / itemBounds.duration) * 100)));
  }

  async function save(next: NewsClipWiseProgress) {
    setProgress((current) => ({ ...current, [progressKey(next.videoId)]: next }));
    setStatus('Syncing...');
    try {
      const res = await fetch('/api/news/youlearn/clipwise', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: next.videoId,
          clipSeconds: next.clipSeconds,
          done: next.done,
          lastClipIndex: next.lastClipIndex,
          completedAt: next.completedAt,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; progress?: NewsClipWiseProgress; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not sync ClipWise progress.');
      const synced = data.progress ?? next;
      setProgress((current) => ({ ...current, [progressKey(synced.videoId)]: synced }));
      setStatus(synced.completedAt ? 'Video complete' : 'Synced');
    } catch {
      setStatus('Sync failed');
    }
  }

  function completeClip(index = activeClip) {
    const nextDone = new Set(saved.done);
    nextDone.add(index);
    const nextIndex = Math.min(index + 1, totalClips - 1);
    const completedAt = nextDone.size >= totalClips ? saved.completedAt || new Date().toISOString() : saved.completedAt;
    void save({
      videoId: video.id,
      clipSeconds: CLIP_SECONDS,
      done: [...nextDone].sort((a, b) => a - b),
      lastClipIndex: nextIndex,
      completedAt,
      updatedAt: new Date().toISOString(),
    });
    setActiveClipIndex(nextIndex);
  }

  function seekClip(index: number) {
    const next = Math.min(Math.max(index, 0), totalClips - 1);
    const nextBounds = clipBounds(next, duration || video.durationSec);
    setActiveClipIndex(next);
    setCurrentTime(nextBounds.start);
    void save({
      videoId: video.id,
      clipSeconds: CLIP_SECONDS,
      done: saved.done,
      lastClipIndex: next,
      completedAt: saved.completedAt,
      updatedAt: new Date().toISOString(),
    });
    if (videoRef.current) {
      videoRef.current.currentTime = nextBounds.start;
      void videoRef.current.play().catch(() => undefined);
    }
  }

  function onTimeUpdate() {
    const current = videoRef.current?.currentTime ?? 0;
    setCurrentTime(current);
    const nextIndex = Math.min(Math.floor(current / CLIP_SECONDS), totalClips - 1);
    if (nextIndex !== activeClip) setActiveClipIndex(nextIndex);
    const currentBounds = clipBounds(nextIndex, duration || video.durationSec);
    if (!done.has(nextIndex) && current - currentBounds.start >= currentBounds.duration * 0.9) {
      completeClip(nextIndex);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-duo-ink">ClipWise practice</h2>
          <p className="mt-1 text-sm font-semibold text-duo-mute">2 min clips from imported YouLearn videos.</p>
        </div>
        <a
          href="https://clipwise-one.vercel.app/player/mpp62zin56vjlgq54"
          target="_blank"
          rel="noreferrer"
          className="btn-duo bg-white text-duo-blueDark shadow-card"
        >
          Open ClipWise
        </a>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <aside className="card p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="chip cursor-default text-duo-blueDark">2 min clips</span>
            <span className="text-xs font-extrabold text-duo-mute">{doneCount}/{totalClips} complete</span>
          </div>
          <div className="mb-4 h-3 overflow-hidden rounded-full bg-duo-soft">
            <div className="h-full rounded-full bg-duo-green transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {videos.map((video) => {
              const selected = video.id === selectedVideo.id;
              return (
                <button
                  key={video.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-2xl border-2 p-2 text-left transition-colors ${
                    selected ? 'border-duo-blue bg-duo-blue/10' : 'border-duo-border bg-white hover:bg-duo-soft'
                  }`}
                  onClick={() => setSelectedVideoId(video.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={video.thumbnail || '/icon.svg'} alt="" className="h-12 w-16 rounded-xl bg-duo-ink object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-duo-ink">{video.title}</span>
                    <span className="text-[11px] font-extrabold text-duo-mute">
                      {video.durationSec ? formatTime(video.durationSec) : 'Duration on play'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="space-y-3">
          <article className="card overflow-hidden">
            <video
              ref={videoRef}
              controls
              preload="metadata"
              poster={video.thumbnail}
              src={video.url}
              className="aspect-video w-full bg-duo-ink object-cover"
              onLoadedMetadata={(event) => {
                setDuration(Math.round(event.currentTarget.duration || video.durationSec || 0));
                setCurrentTime(event.currentTarget.currentTime || 0);
              }}
              onTimeUpdate={onTimeUpdate}
            />
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                <span className="chip cursor-default">Clip {activeClip + 1} of {totalClips}</span>
                <span className="chip cursor-default">
                  {formatTime(bounds.start)} - {formatTime(bounds.end)}
                </span>
                {saved.completedAt && <span className="chip cursor-default text-duo-greenDark">Completed</span>}
                {status && <span className="chip cursor-default text-duo-blueDark">{status}</span>}
              </div>
              <h3 className="text-base font-extrabold leading-tight text-duo-ink">{video.title}</h3>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-duo bg-duo-blue text-white shadow-duoBlue" onClick={() => seekClip(activeClip)}>
                  Play clip
                </button>
                <button type="button" className="btn-duo bg-duo-green text-white shadow-duoGreen" onClick={() => completeClip()}>
                  Complete clip
                </button>
              </div>
            </div>
          </article>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: totalClips }).map((_, index) => {
              const itemBounds = clipBounds(index, duration || video.durationSec);
              const complete = done.has(index);
              const selected = index === activeClip;
              const clipPct = clipProgressPercent(index);
              return (
                <button
                  key={index}
                  type="button"
                  className={`rounded-2xl border-2 p-3 text-left shadow-card transition-transform active:translate-y-[2px] ${
                    complete
                      ? 'border-duo-green bg-duo-green text-white'
                      : selected
                        ? 'border-duo-blue bg-duo-blue text-white'
                        : 'border-duo-border bg-white text-duo-ink hover:bg-duo-soft'
                  }`}
                  onClick={() => seekClip(index)}
                >
                  <span className="block text-xs font-extrabold uppercase">Clip {index + 1}</span>
                  <span className="mt-1 block text-sm font-bold">
                    {formatTime(itemBounds.start)} - {formatTime(itemBounds.end)}
                  </span>
                  <span className="mt-2 block text-xs font-extrabold opacity-80">
                    {complete ? 'Complete' : selected ? 'Playing' : 'Ready'}
                  </span>
                  <span className="mt-3 block h-2 overflow-hidden rounded-full bg-black/10">
                    <span
                      className={`block h-full rounded-full transition-all ${
                        complete ? 'bg-white' : selected ? 'bg-white/90' : 'bg-duo-green'
                      }`}
                      style={{ width: `${clipPct}%` }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
