'use client';

import type { DiscoveredChannel } from '@/lib/types';

export type TopVideo = {
  id: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  durationSec?: number;
};

export function formatCount(value: number | undefined): string {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function channelPayload(channel: DiscoveredChannel) {
  return {
    id: channel.id,
    title: channel.title,
    thumbnail: channel.thumbnail,
    description: channel.description,
    subscriberCount: channel.subscriberCount,
    viewCount: channel.viewCount,
    videoCount: channel.videoCount,
    country: channel.country,
  };
}

export function DiscoverChannelCard({
  channel,
  selected,
  working,
  statsWorking,
  topWorking,
  topVideos,
  onFetchStats,
  onFetchTopVideos,
  onAccept,
  onIgnore,
}: {
  channel: DiscoveredChannel;
  selected: boolean;
  working: boolean;
  statsWorking: boolean;
  topWorking: boolean;
  topVideos?: TopVideo[];
  onFetchStats: () => void;
  onFetchTopVideos: () => void;
  onAccept: () => void;
  onIgnore: () => void;
}) {
  const hasStats =
    typeof channel.subscriberCount === 'number' ||
    typeof channel.viewCount === 'number' ||
    typeof channel.videoCount === 'number';
  const hasTopVideos = Array.isArray(topVideos);

  return (
    <article className="card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {channel.thumbnail ? (
          <img src={channel.thumbnail} alt="" className="h-16 w-16 rounded-2xl object-cover" />
        ) : (
          <div className="h-16 w-16 rounded-2xl bg-duo-soft" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-extrabold text-duo-ink">{channel.title}</h3>
            {selected && <span className="chip chip-active cursor-default text-xs">Selected</span>}
          </div>
          <p className="line-clamp-2 text-sm font-semibold text-duo-ink/60">{channel.description || channel.id}</p>
          <div className="flex flex-wrap gap-2 text-xs font-extrabold text-duo-ink/55">
            <span className="chip cursor-default">Subs {formatCount(channel.subscriberCount)}</span>
            <span className="chip cursor-default">Views {formatCount(channel.viewCount)}</span>
            <span className="chip cursor-default">Videos {formatCount(channel.videoCount)}</span>
            {channel.country && <span className="chip cursor-default">{channel.country}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <button className="btn-duo-blue flex-1 px-3 py-2 text-xs" disabled={statsWorking} onClick={onFetchStats}>
            {statsWorking ? '...' : hasStats ? 'Refresh stats' : 'Fetch stats'}
          </button>
          <button
            className="btn-duo-ghost flex-1 px-3 py-2 text-xs"
            disabled={topWorking}
            onClick={onFetchTopVideos}
            title="Fetch this channel's top 3 videos by views, likes, comments"
          >
            {topWorking ? '...' : hasTopVideos ? 'Refresh top 3' : 'Top 3 videos'}
          </button>
          <button className="btn-duo-green flex-1 px-3 py-2 text-xs" disabled={working || selected} onClick={onAccept}>
            {selected ? 'Added' : working ? '...' : 'Select'}
          </button>
          <button className="btn-duo-ghost flex-1 px-3 py-2 text-xs text-red-500" disabled={working} onClick={onIgnore}>
            {working ? '...' : 'Ignore'}
          </button>
        </div>
      </div>
      {hasTopVideos && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-duo-ink/45">
            Top 3 videos (views → likes → comments)
          </p>
          {topVideos!.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-3 text-sm font-bold text-duo-mute">
              No public videos found.
            </p>
          ) : (
            <ul className="space-y-2">
              {topVideos!.map((video) => (
                <li key={video.id}>
                  <a
                    href={`https://www.youtube.com/watch?v=${video.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 rounded-2xl border-2 border-duo-border bg-duo-soft/40 p-2 hover:bg-duo-soft"
                  >
                    {video.thumbnail ? (
                      <img src={video.thumbnail} alt="" className="h-16 w-28 shrink-0 rounded-xl object-cover" />
                    ) : (
                      <div className="h-16 w-28 shrink-0 rounded-xl bg-duo-soft" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="line-clamp-2 text-sm font-extrabold text-duo-ink">{video.title}</p>
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-extrabold text-duo-ink/55">
                        <span className="chip cursor-default">Views {formatCount(video.viewCount)}</span>
                        <span className="chip cursor-default">Likes {formatCount(video.likeCount)}</span>
                        <span className="chip cursor-default">Comments {formatCount(video.commentCount)}</span>
                        {typeof video.durationSec === 'number' && (
                          <span className="chip cursor-default">{formatDuration(video.durationSec)}</span>
                        )}
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
