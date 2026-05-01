'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCard } from '@/components/VideoCard';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { INSTAGRAM_SAVED_PREFIX, getSavedVideoKind, type SavedVideo, type Video } from '@/lib/types';

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export function SavedVideosClient({
  savedVideos,
  videos,
  now,
}: {
  savedVideos: SavedVideo[];
  videos: Video[];
  now: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const videoById = new Map(videos.map((video) => [video.id, video]));

  function mutate(body: Record<string, unknown>, clear = false) {
    startTransition(() => {
      void fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(() => {
        if (clear) {
          setUrl('');
          setNote('');
        }
        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  return (
    <>
      <section className="card p-4 sm:p-5">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            mutate({ type: 'addSavedVideo', url, note }, true);
          }}
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
      </section>

      {savedVideos.length === 0 ? (
        <div className="card p-8 text-center font-bold text-duo-mute">No saved videos yet.</div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {savedVideos.map((saved) => {
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
                    onBlur={(event) =>
                      mutate({ type: 'updateSavedVideo', id: saved.id, note: event.currentTarget.value })
                    }
                    className="min-h-10 w-full rounded-xl border-2 border-duo-border p-2 text-xs font-bold outline-none focus:border-duo-green"
                    placeholder="Why did you save this?"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <time className="text-xs font-bold text-duo-mute">
                      Added {new Date(saved.addedAt).toLocaleString()}
                    </time>
                    <button
                      type="button"
                      onClick={() => mutate({ type: 'removeSavedVideo', id: saved.id })}
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
