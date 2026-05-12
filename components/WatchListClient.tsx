'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCard } from '@/components/VideoCard';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import type { Video } from '@/lib/types';
import { INSTAGRAM_SAVED_PREFIX, getSavedVideoKind, type SavedVideo } from '@/lib/saved-videos';

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function mergeById(current: SavedVideo[], incoming: SavedVideo[]): SavedVideo[] {
  const seen = new Set<string>();
  const out: SavedVideo[] = [];
  for (const video of [...incoming, ...current]) {
    if (!video.id || seen.has(video.id)) continue;
    seen.add(video.id);
    out.push(video);
  }
  return out;
}

export function WatchListClient({
  initialSaved,
  videos,
  now,
}: {
  initialSaved: SavedVideo[];
  videos: Video[];
  now: number;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialKey = useRef(initialSaved.map((video) => video.id).join('|'));

  // Reconcile when server props change (router.refresh, navigations) without
  // dropping local-only items the server may not yet reflect.
  useEffect(() => {
    const key = initialSaved.map((video) => video.id).join('|');
    if (key === initialKey.current) return;
    initialKey.current = key;
    setSaved((current) => mergeById(current, initialSaved));
  }, [initialSaved]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/saved-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, note }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        savedVideo?: SavedVideo;
        synced?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.savedVideo) {
        setError(data?.error ?? 'Failed to save this item.');
        return;
      }
      setSaved((current) => [data.savedVideo!, ...current.filter((video) => video.id !== data.savedVideo!.id)]);
      setUrl('');
      setNote('');
      router.refresh();
    } catch {
      setError('Failed to save this item.');
    } finally {
      setPending(false);
    }
  }

  async function handleUpdateNote(id: string, nextNote: string) {
    try {
      await fetch(`/api/saved-videos/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: nextNote }),
      });
      setSaved((current) =>
        current.map((video) => (video.id === id ? { ...video, note: nextNote } : video)),
      );
    } catch {
      setError('Failed to update note.');
    }
  }

  async function handleRemove(id: string) {
    setSaved((current) => current.filter((video) => video.id !== id));
    try {
      await fetch(`/api/saved-videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      router.refresh();
    } catch {
      setError('Failed to remove item.');
    }
  }

  const videoById = new Map(videos.map((video) => [video.id, video]));
  const sorted = [...saved].sort((a, b) => {
    const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0;
    const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <>
      <section className="card p-4 sm:p-5">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto]"
          onSubmit={handleAdd}
        >
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste YouTube, Instagram, or webpage URL"
            className="min-w-0 rounded-chonk border-2 border-duo-border px-4 py-2 text-sm font-bold outline-none focus:border-duo-green"
            required
          />
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Tag or note"
            className="min-w-0 rounded-chonk border-2 border-duo-border px-4 py-2 text-sm font-bold outline-none focus:border-duo-green"
          />
          <button type="submit" className="btn-duo-green" disabled={pending}>
            {pending ? '...' : 'Add'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm font-bold text-red-500">{error}</p>}
      </section>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center font-bold text-duo-mute">No saved videos yet.</div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((saved) => {
            const video = videoById.get(saved.id);
            const kind = getSavedVideoKind(saved);
            const igEmbedSrc =
              kind === 'instagram'
                ? `https://www.instagram.com/${saved.url.includes('/reel/') ? 'reel' : 'p'}/${saved.id.slice(INSTAGRAM_SAVED_PREFIX.length)}/embed/`
                : null;

            return (
              <article key={saved.id} className="card flex h-full flex-col overflow-hidden">
                <div className="flex flex-1 flex-col">
                  {kind === 'instagram' && igEmbedSrc ? (
                    <>
                      <div className="aspect-[16/10] w-full bg-black">
                        <iframe
                          src={igEmbedSrc}
                          className="h-full w-full border-0"
                          loading="lazy"
                          allowFullScreen
                          scrolling="no"
                          title="Instagram reel"
                        />
                      </div>
                      <div className="border-t-2 border-duo-border bg-duo-soft px-2 py-1 text-[11px] font-bold text-duo-mute">
                        Instagram ·{' '}
                        <a href={saved.url} target="_blank" rel="noreferrer" className="text-duo-green underline">
                          Open
                        </a>
                      </div>
                    </>
                  ) : kind === 'webpage' ? (
                    <a
                      href={saved.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex flex-1 flex-col gap-1 bg-duo-soft p-3 transition hover:bg-duo-green/10"
                    >
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-duo-blueDark border border-duo-border">
                        <span aria-hidden>🔗</span> Webpage
                      </span>
                      <span className="text-sm font-extrabold text-duo-ink">
                        {getHostname(saved.url)}
                      </span>
                      <span className="break-all text-xs font-bold text-duo-mute">
                        {saved.url}
                      </span>
                    </a>
                  ) : video ? (
                    <div className="[&_.aspect-video]:aspect-[16/10]">
                      <VideoCard video={video} now={now} onOpen={setActiveVideo} />
                    </div>
                  ) : (
                    <a href={saved.url} target="_blank" rel="noreferrer" className="block flex-1 bg-duo-soft p-3 text-sm font-bold">
                      {saved.url}
                    </a>
                  )}
                </div>
                <div className="mt-auto space-y-1 border-t-2 border-duo-border p-2">
                  <textarea
                    defaultValue={saved.note}
                    onBlur={(event) => void handleUpdateNote(saved.id, event.currentTarget.value)}
                    className="min-h-10 w-full rounded-xl border-2 border-duo-border p-2 text-xs font-bold outline-none focus:border-duo-green"
                    placeholder="Why did you save this?"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <time className="text-xs font-bold text-duo-mute">
                      Added {new Date(saved.addedAt).toLocaleString()}
                    </time>
                    <button
                      type="button"
                      onClick={() => void handleRemove(saved.id)}
                      className="chip border-red-200 text-red-500 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <VideoPlayerModal video={activeVideo} now={now} onClose={() => setActiveVideo(null)} />
    </>
  );
}
