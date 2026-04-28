'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCard } from '@/components/VideoCard';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import type { SavedVideo, Video } from '@/lib/types';

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
            placeholder="Paste YouTube video URL"
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
            return (
              <article key={saved.id} className="card overflow-hidden">
                {video ? (
                  <VideoCard video={video} now={now} onOpen={setActiveVideo} />
                ) : (
                  <a href={saved.url} target="_blank" rel="noreferrer" className="block bg-duo-soft p-5 font-bold">
                    {saved.url}
                  </a>
                )}
                <div className="space-y-2 border-t-2 border-duo-border p-3">
                  <textarea
                    defaultValue={saved.note}
                    onBlur={(event) =>
                      mutate({ type: 'updateSavedVideo', id: saved.id, note: event.currentTarget.value })
                    }
                    className="min-h-20 w-full rounded-2xl border-2 border-duo-border p-3 text-sm font-bold outline-none focus:border-duo-green"
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
