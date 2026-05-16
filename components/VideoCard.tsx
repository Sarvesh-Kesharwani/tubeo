'use client';

import { useState } from 'react';
import Image from 'next/image';
import { timeAgo } from '@/lib/time';
import type { Video } from '@/lib/types';

type SummaryState =
  | { status: 'idle'; bullets: string[]; error: null }
  | { status: 'loading'; bullets: string[]; error: null }
  | { status: 'ready'; bullets: string[]; error: null }
  | { status: 'error'; bullets: string[]; error: string };

export function VideoCard({
  video,
  now,
  onOpen,
  showChannel = true,
  showSummary = true,
}: {
  video: Video;
  now: number;
  onOpen?: (video: Video) => void;
  showChannel?: boolean;
  showSummary?: boolean;
}) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const [summary, setSummary] = useState<SummaryState>({
    status: 'idle',
    bullets: [],
    error: null,
  });

  async function handleSummary() {
    if (summary.status === 'loading') return;
    if (summary.status === 'ready') {
      setSummary({ status: 'idle', bullets: summary.bullets, error: null });
      return;
    }
    if (summary.bullets.length > 0) {
      setSummary({ status: 'ready', bullets: summary.bullets, error: null });
      return;
    }

    setSummary({ status: 'loading', bullets: [], error: null });
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(video.id)}/summary`);
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        bullets?: string[];
        error?: string;
      } | null;

      if (!response.ok || !data?.ok || !Array.isArray(data.bullets)) {
        setSummary({
          status: 'error',
          bullets: [],
          error: data?.error ?? 'Could not summarize this video.',
        });
        return;
      }

      setSummary({ status: 'ready', bullets: data.bullets, error: null });
      window.dispatchEvent(new CustomEvent('tubeo-quota-updated'));
    } catch {
      setSummary({ status: 'error', bullets: [], error: 'Could not summarize this video.' });
    }
  }

  const content = (
    <>
      <div className="relative aspect-video bg-duo-soft">
        {video.thumbnail && (
          <Image
            src={video.thumbnail}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
          />
        )}
        <div className="absolute left-2 top-2 rounded-full bg-duo-ink/85 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-white">
          {video.isShort ? 'Short' : 'Video'}
        </div>
      </div>

      <div className="p-3 flex gap-3">
        {showChannel && video.channelThumbnail && (
          <Image
            src={video.channelThumbnail}
            alt={video.channelTitle}
            width={40}
            height={40}
            className="rounded-full border-2 border-duo-border shrink-0"
          />
        )}

        <div className="min-w-0">
          <h3 suppressHydrationWarning className="font-bold text-duo-ink line-clamp-2 leading-snug">
            {video.title}
          </h3>
          <p className="text-sm text-duo-mute mt-1 truncate">
            {showChannel && (
              <span
                role="link"
                tabIndex={0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(`https://www.youtube.com/channel/${video.channelId}`, '_blank', 'noreferrer');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(`https://www.youtube.com/channel/${video.channelId}`, '_blank', 'noreferrer');
                  }
                }}
                className="font-semibold text-duo-ink hover:underline cursor-pointer"
              >
                {video.channelTitle}
              </span>
            )}
            {showChannel && ' • '}
            <span>{timeAgo(video.publishedAt, now)}</span>
          </p>
        </div>
      </div>
    </>
  );

  const summaryPanel = showSummary ? (
    <div className="border-t-2 border-duo-border bg-duo-soft/60 p-2">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void handleSummary();
        }}
        className="chip w-full justify-center px-2 py-1 text-[11px] text-duo-blueDark"
        disabled={summary.status === 'loading'}
        aria-expanded={summary.status === 'ready'}
      >
        {summary.status === 'loading' ? 'Summarizing...' : summary.status === 'ready' ? 'Hide summary' : 'Bullet summary'}
      </button>

      {summary.status === 'ready' && (
        <ul className="mt-2 space-y-1 rounded-2xl border-2 border-duo-border bg-white p-2 text-xs font-bold leading-snug text-duo-ink">
          {summary.bullets.map((bullet, index) => (
            <li key={`${video.id}-summary-${index}`} className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-duo-green" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      )}

      {summary.status === 'error' && (
        <p className="mt-2 rounded-2xl border-2 border-red-100 bg-white px-2 py-1 text-xs font-bold text-red-500">
          {summary.error}
        </p>
      )}
    </div>
  ) : null;

  if (onOpen) {
    return (
      <article className="card block w-full text-left transition-transform hover:-translate-y-0.5">
        <button type="button" onClick={() => onOpen(video)} className="block w-full text-left" aria-label={`Play ${video.title}`}>
          {content}
        </button>
        {summaryPanel}
      </article>
    );
  }

  return (
    <article className="card block transition-transform hover:-translate-y-0.5">
      <a href={watchUrl} target="_blank" rel="noreferrer" className="block">
        {content}
      </a>
      {summaryPanel}
    </article>
  );
}
