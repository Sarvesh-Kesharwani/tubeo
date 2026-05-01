'use client';

import { useState } from 'react';
import Image from 'next/image';
import { VideoCard } from './VideoCard';
import { VideoPlayerModal } from './VideoPlayerModal';
import type { ChannelWithVideos, Video } from '@/lib/types';

export function ChannelRow({ data, now }: { data: ChannelWithVideos; now: number }) {
  const { channel, videos } = data;
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const shortCount = videos.filter((video) => video.isShort).length;
  const regularVideoCount = videos.length - shortCount;
  const summary =
    shortCount > 0 && regularVideoCount > 0
      ? `${regularVideoCount} video${regularVideoCount === 1 ? '' : 's'} and ${shortCount} short${shortCount === 1 ? '' : 's'}`
      : shortCount > 0
        ? `${shortCount} new short${shortCount === 1 ? '' : 's'}`
        : `${regularVideoCount} new video${regularVideoCount === 1 ? '' : 's'}`;

  return (
    <>
      <section className="space-y-3">
        <header className="flex items-center gap-3">
          {channel.thumbnail && (
            <a
              href={`https://www.youtube.com/channel/${channel.id}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${channel.title} on YouTube`}
            >
              <Image
                src={channel.thumbnail}
                alt={channel.title}
                width={48}
                height={48}
                className="rounded-full border-2 border-duo-border"
              />
            </a>
          )}
          <div className="min-w-0">
            <a
              href={`https://www.youtube.com/channel/${channel.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-lg text-duo-ink truncate hover:underline block"
            >
              {channel.title}
            </a>
            <p className="text-sm text-duo-mute">{summary}</p>
          </div>
        </header>

        {videos.length === 0 ? (
          <div className="card p-6 text-center text-duo-mute">
            No new uploads in this range.
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory -mx-4 px-4">
            {videos.map((v) => (
              <div key={v.id} className="snap-start shrink-0 w-[300px]">
                <VideoCard video={v} now={now} showChannel={false} onOpen={setActiveVideo} />
              </div>
            ))}
          </div>
        )}
      </section>

      <VideoPlayerModal video={activeVideo} now={now} onClose={() => setActiveVideo(null)} />
    </>
  );
}
