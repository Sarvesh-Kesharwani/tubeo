'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_KEYWORDS = ['funny', 'comedy', 'viral', 'short', 'reel', 'cute', 'amazing', 'scary'];

const ORDER_OPTIONS: Array<{ value: 'viewCount' | 'date' | 'relevance' | 'rating'; label: string }> = [
  { value: 'viewCount', label: 'Most viewed' },
  { value: 'date', label: 'Newest' },
  { value: 'relevance', label: 'Relevance' },
  { value: 'rating', label: 'Rating' },
];

type ShortVideo = {
  id: string;
  title: string;
  thumbnail: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  durationSec?: number;
};

function formatCount(value: number | undefined): string {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function ShortFeedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [keywordsInput, setKeywordsInput] = useState(DEFAULT_KEYWORDS.join(', '));
  const today = useMemo(() => todayIsoDate(), []);
  const [publishedAfter, setPublishedAfter] = useState(today);
  const [publishedBefore, setPublishedBefore] = useState(today);
  const [order, setOrder] = useState<'viewCount' | 'date' | 'relevance' | 'rating'>('viewCount');
  const [stage, setStage] = useState<'config' | 'viewing'>('config');
  const [videos, setVideos] = useState<ShortVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [quotaUnits, setQuotaUnits] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!open) {
      setStage('config');
      setVideos([]);
      setActiveId(null);
      setError(null);
      setQuotaUnits(0);
    }
  }, [open]);

  useEffect(() => {
    if (stage !== 'viewing') return;
    const root = viewportRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = top?.target.getAttribute('data-feed-id');
        if (id) setActiveId(id);
      },
      { root, threshold: [0.55, 0.7, 0.9] },
    );

    for (const video of videos) {
      const node = itemRefs.current[video.id];
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [stage, videos]);

  function toggleKeyword(keyword: string) {
    const current = keywordsInput
      .split(/[,\n]/)
      .map((token) => token.trim())
      .filter(Boolean);
    const lower = keyword.toLowerCase();
    const exists = current.some((token) => token.toLowerCase() === lower);
    const next = exists ? current.filter((token) => token.toLowerCase() !== lower) : [...current, keyword];
    setKeywordsInput(next.join(', '));
  }

  function isKeywordActive(keyword: string): boolean {
    const lower = keyword.toLowerCase();
    return keywordsInput
      .split(/[,\n]/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)
      .includes(lower);
  }

  async function startFeed() {
    const keywords = keywordsInput
      .split(/[,\n]/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      setError('Add at least one keyword.');
      return;
    }
    if (publishedAfter && publishedBefore && publishedAfter > publishedBefore) {
      setError('"From" date must be on or before "To" date.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const q = keywords.join(' | ');
      const params = new URLSearchParams({ q, order });
      if (publishedAfter) params.set('publishedAfter', publishedAfter);
      if (publishedBefore) params.set('publishedBefore', publishedBefore);

      const response = await fetch(`/api/short-feed?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Failed to fetch short videos.');
        return;
      }
      const fetched = (data.videos ?? []) as ShortVideo[];
      if (fetched.length === 0) {
        setError('No short videos found for these keywords + date range.');
        return;
      }
      setVideos(fetched);
      setQuotaUnits(Number(data.quotaUnits ?? 0));
      setActiveId(fetched[0].id);
      setStage('viewing');
    } catch {
      setError('Failed to fetch short videos.');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-duo-ink/80 px-3 py-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden rounded-chonk border-2 border-duo-border bg-white shadow-card">
        <div className="flex items-center justify-between gap-3 border-b-2 border-duo-border bg-duo-soft px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Short Feed</p>
            <p className="truncate text-xs font-bold text-duo-mute">
              {stage === 'config'
                ? 'Pick keywords + dates, then start'
                : `${videos.length} shorts • ${quotaUnits} quota units`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {stage === 'viewing' && (
              <button type="button" onClick={() => setStage('config')} className="btn-duo-ghost px-3 py-2 text-xs">
                Back
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-duo-ghost px-3 py-2 text-xs">
              Close
            </button>
          </div>
        </div>

        {stage === 'config' ? (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="space-y-2">
              <span className="text-xs font-extrabold uppercase text-duo-ink/55">Default keywords</span>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_KEYWORDS.map((keyword) => {
                  const active = isKeywordActive(keyword);
                  return (
                    <button
                      key={keyword}
                      type="button"
                      onClick={() => toggleKeyword(keyword)}
                      className={`chip text-xs ${active ? 'chip-active' : ''}`}
                    >
                      {active ? `× ${keyword}` : `+ ${keyword}`}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-extrabold uppercase text-duo-ink/55">Keywords / hashtags</span>
              <textarea
                value={keywordsInput}
                onChange={(event) => setKeywordsInput(event.target.value)}
                rows={3}
                className="w-full rounded-2xl border-2 border-duo-border px-3 py-2 text-sm font-bold outline-none focus:border-duo-green"
                placeholder="Comma-separated: funny, comedy, viral"
              />
              <span className="block text-[11px] font-bold text-duo-mute">
                Tubeo OR-merges these when querying YouTube ("funny | comedy | viral").
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-extrabold uppercase text-duo-ink/55">From</span>
                <input
                  type="date"
                  value={publishedAfter}
                  onChange={(event) => setPublishedAfter(event.target.value)}
                  className="w-full rounded-2xl border-2 border-duo-border px-3 py-2 text-sm font-bold outline-none focus:border-duo-green"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-extrabold uppercase text-duo-ink/55">To</span>
                <input
                  type="date"
                  value={publishedBefore}
                  onChange={(event) => setPublishedBefore(event.target.value)}
                  className="w-full rounded-2xl border-2 border-duo-border px-3 py-2 text-sm font-bold outline-none focus:border-duo-green"
                />
              </label>
            </div>

            <label className="space-y-1">
              <span className="text-xs font-extrabold uppercase text-duo-ink/55">Sort</span>
              <select
                value={order}
                onChange={(event) => setOrder(event.target.value as typeof order)}
                className="w-full rounded-2xl border-2 border-duo-border bg-white px-3 py-2 text-sm font-bold outline-none focus:border-duo-green"
              >
                {ORDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {error && <p className="text-sm font-bold text-red-500">{error}</p>}

            <button
              type="button"
              onClick={() => void startFeed()}
              disabled={loading}
              className="btn-duo-green w-full"
            >
              {loading ? 'Fetching shorts...' : 'Start short feed'}
            </button>

            <p className="text-[11px] font-bold text-duo-mute">
              Cost: ~101 YouTube quota units per fetch. Returns up to 50 shorts (≤180s).
            </p>
          </div>
        ) : (
          <div ref={viewportRef} className="h-full snap-y snap-mandatory overflow-y-auto bg-black">
            {videos.map((video) => {
              const active = activeId === video.id;
              return (
                <section
                  key={video.id}
                  ref={(node) => {
                    itemRefs.current[video.id] = node;
                  }}
                  data-feed-id={video.id}
                  className="relative flex h-full snap-start flex-col bg-black"
                >
                  <div className="min-h-0 flex-1">
                    <iframe
                      key={`${video.id}-${active ? 'active' : 'idle'}`}
                      src={`https://www.youtube.com/embed/${video.id}?playsinline=1&rel=0${active ? '&autoplay=1&mute=1' : ''}`}
                      className="h-full w-full border-0"
                      title={video.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 text-white">
                    <p className="line-clamp-2 text-sm font-extrabold">{video.title}</p>
                    <p className="mt-1 text-xs font-bold text-white/75">
                      {video.channelTitle || 'YouTube'}
                      {typeof video.viewCount === 'number' ? ` • ${formatCount(video.viewCount)} views` : ''}
                      {typeof video.likeCount === 'number' ? ` • ${formatCount(video.likeCount)} likes` : ''}
                      {typeof video.commentCount === 'number' ? ` • ${formatCount(video.commentCount)} comments` : ''}
                    </p>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
