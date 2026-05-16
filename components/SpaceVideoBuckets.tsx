'use client';

import { useMemo, useState } from 'react';
import { VideoCard } from './VideoCard';
import { VideoPlayerModal } from './VideoPlayerModal';
import type { ChannelWithVideos, Video } from '@/lib/types';

const FIVE_MINUTES = 5 * 60;
const FIFTEEN_MINUTES = 15 * 60;

const BUCKETS = [
  { key: 'under5', label: '<5mins' },
  { key: 'under15', label: '<15mins' },
  { key: 'others', label: 'Others' },
] as const;

type BucketKey = (typeof BUCKETS)[number]['key'];

function bucketFor(video: Video): BucketKey {
  if (typeof video.durationSec === 'number' && video.durationSec < FIVE_MINUTES) return 'under5';
  if (typeof video.durationSec === 'number' && video.durationSec < FIFTEEN_MINUTES) return 'under15';
  return 'others';
}

function flattenVideos(groups: ChannelWithVideos[]): Video[] {
  const seen = new Set<string>();
  const videos: Video[] = [];

  for (const group of groups) {
    for (const video of group.videos) {
      if (seen.has(video.id)) continue;
      seen.add(video.id);
      videos.push(video);
    }
  }

  return videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function SpaceVideoBuckets({
  groups,
  now,
  emptyText = 'No videos in this space for the current filter.',
}: {
  groups: ChannelWithVideos[];
  now: number;
  emptyText?: string;
}) {
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const videos = useMemo(() => flattenVideos(groups), [groups]);
  const grouped = useMemo(
    () =>
      BUCKETS.map((bucket) => ({
        ...bucket,
        videos: videos.filter((video) => bucketFor(video) === bucket.key),
      })),
    [videos],
  );

  if (videos.length === 0) {
    return (
      <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/50 px-4 py-5 text-sm font-semibold text-duo-mute">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {grouped.map((bucket) => (
          <section
            key={bucket.key}
            className="rounded-chonk border-2 border-duo-border bg-white p-3 sm:p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-extrabold text-duo-blueDark">{bucket.label}</h3>
              <span className="chip cursor-default px-2 py-1 text-[11px]">{bucket.videos.length}</span>
            </div>

            {bucket.videos.length === 0 ? (
              <div className="min-h-24 rounded-2xl border-2 border-dashed border-duo-border bg-duo-soft/40 px-4 py-6 text-center text-sm font-bold text-duo-mute">
                No videos here.
              </div>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
                {bucket.videos.map((video) => (
                  <div key={video.id} className="w-[300px] shrink-0 snap-start">
                    <VideoCard video={video} now={now} showChannel onOpen={setActiveVideo} />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <VideoPlayerModal video={activeVideo} now={now} onClose={() => setActiveVideo(null)} />
    </>
  );
}
