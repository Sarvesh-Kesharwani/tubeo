'use client';

import { useMemo, useState } from 'react';
import { VideoCard } from './VideoCard';
import { VideoPlayerModal } from './VideoPlayerModal';
import type { ChannelWithVideos, Video } from '@/lib/types';

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

  if (videos.length === 0) {
    return (
      <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/50 px-4 py-5 text-sm font-semibold text-duo-mute">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} now={now} showChannel onOpen={setActiveVideo} />
        ))}
      </div>

      <VideoPlayerModal video={activeVideo} now={now} onClose={() => setActiveVideo(null)} />
    </>
  );
}
