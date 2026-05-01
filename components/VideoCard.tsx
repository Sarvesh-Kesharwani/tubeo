'use client';

import Image from 'next/image';
import { timeAgo } from '@/lib/time';
import type { Video } from '@/lib/types';

export function VideoCard({
  video,
  now,
  onOpen,
  showChannel = true,
}: {
  video: Video;
  now: number;
  onOpen?: (video: Video) => void;
  showChannel?: boolean;
}) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.id}`;

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

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpen(video)}
        className="card block w-full text-left hover:-translate-y-0.5 transition-transform"
        aria-label={`Play ${video.title}`}
      >
        {content}
      </button>
    );
  }

  return (
    <a
      href={watchUrl}
      target="_blank"
      rel="noreferrer"
      className="card block hover:-translate-y-0.5 transition-transform"
    >
      {content}
    </a>
  );
}
