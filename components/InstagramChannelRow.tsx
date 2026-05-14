import { timeAgo } from '@/lib/time';
import type { InstagramReel } from '@/lib/instagram';

export function InstagramChannelRow({
  title,
  url,
  reels,
  error,
  now,
}: {
  title: string;
  url: string;
  reels: InstagramReel[];
  error?: string;
  now: number;
}) {
  return (
    <section className="space-y-3">
      <header className="flex items-center gap-3">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-duo-border bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] text-lg font-black text-white"
          aria-label={`Open ${title} on Instagram`}
        >
          IG
        </a>
        <div className="min-w-0">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-lg font-bold text-duo-ink hover:underline"
          >
            {title}
          </a>
          <p className="text-sm text-duo-mute">
            {error ? 'Instagram API setup needed' : `${reels.length} latest reel${reels.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </header>

      {error ? (
        <div className="card p-6 text-sm font-bold text-duo-mute">{error}</div>
      ) : reels.length === 0 ? (
        <div className="card p-6 text-center text-duo-mute">No reels returned yet.</div>
      ) : (
        <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2">
          {reels.map((reel) => (
            <a
              key={reel.id}
              href={reel.url}
              target="_blank"
              rel="noreferrer"
              className="card block w-[300px] shrink-0 snap-start overflow-hidden transition-transform hover:-translate-y-0.5"
            >
              <div className="relative aspect-[9/12] bg-duo-soft">
                {reel.thumbnail ? (
                  <img
                    src={reel.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-3xl font-black text-duo-ink/30">IG</div>
                )}
                <div className="absolute left-2 top-2 rounded-full bg-duo-ink/85 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-white">
                  Reel
                </div>
              </div>
              <div className="p-3">
                <h3 className="line-clamp-2 font-bold leading-snug text-duo-ink">{reel.title}</h3>
                <p className="mt-1 truncate text-sm text-duo-mute">
                  @{reel.channelUsername} - {timeAgo(reel.publishedAt, now)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
