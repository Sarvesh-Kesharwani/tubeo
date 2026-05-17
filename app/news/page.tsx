import { Suspense } from 'react';
import { ChannelRow } from '@/components/ChannelRow';
import { DurationFilter } from '@/components/DurationFilter';
import { EmptyState } from '@/components/EmptyState';
import { MediaTypeFilter } from '@/components/MediaTypeFilter';
import { NewsPromptEditor } from '@/components/NewsPromptEditor';
import { NewsHistory } from '@/components/NewsHistory';
import { NewsSummaryCard } from '@/components/NewsSummaryCard';
import { TimeFilter } from '@/components/TimeFilter';
import { ViewPreferenceTracker } from '@/components/ViewPreferenceTracker';
import { getCookieViewPreferences } from '@/lib/channels-cookie';
import { matchesDurationFilter, parseDurationFilter } from '@/lib/duration';
import { parseMediaFilter } from '@/lib/media';
import { readNewsForUser } from '@/lib/news-service';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import { normalizeSpaceName } from '@/lib/spaces';
import { isSupabaseNewsConfigured, readNewsState } from '@/lib/supabase-news';
import { getTubeoUserIdentity } from '@/lib/supabase-sync';
import { istDateString } from '@/lib/news-source';
import { parseRange } from '@/lib/time';
import { getChannelGroupedFeedWithQuota } from '@/lib/youtube';
import { getWhitelistedChannelPreferences } from '@/lib/whitelist';

const NEWS_SPACE = 'News';

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; media?: string; duration?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const selectedDate = sp.date;
  const view = await getCookieViewPreferences();
  const range = parseRange(sp.range ?? view.channels.range);
  const media = parseMediaFilter(sp.media ?? view.channels.media);
  const duration = parseDurationFilter(sp.duration ?? view.channels.duration);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink">News</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Suspense fallback={null}>
              <NewsPromptSection />
            </Suspense>
          </div>
        </div>
        <p className="text-sm text-duo-mute">
          Today's UPSC current-affairs digest from InsightsOnIndia plus videos from channels you've assigned to the
          "{NEWS_SPACE}" space.
        </p>
      </section>

      <Suspense fallback={<SummarySkeleton />}>
        <NewsSummarySection date={selectedDate} />
      </Suspense>

      <Suspense fallback={null}>
        <NewsHistorySection date={selectedDate} />
      </Suspense>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold text-duo-ink">News channel videos</h2>
        <Suspense fallback={null}>
          <TimeFilter active={range} />
        </Suspense>
        <Suspense fallback={null}>
          <MediaTypeFilter active={media} />
        </Suspense>
        <Suspense fallback={null}>
          <DurationFilter active={duration} />
        </Suspense>
      </section>

      <Suspense key={`${range}:${media}:${duration}`} fallback={<VideosSkeleton />}>
        <NewsVideos range={range} media={media} duration={duration} />
      </Suspense>

      <ViewPreferenceTracker
        page="channels"
        range={range}
        media={media}
        duration={duration}
        space={NEWS_SPACE}
      />
    </div>
  );
}

async function NewsSummarySection({ date }: { date?: string }) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);

  if (!identity) {
    return (
      <EmptyState
        emoji="📰"
        title="Sign in to see today's summary"
        description="Tubeo personalises the InsightsOnIndia summary per user using your own DeepSeek prompt."
      />
    );
  }

  if (!isSupabaseNewsConfigured()) {
    return (
      <EmptyState
        emoji="!"
        title="News sync not configured"
        description="Set TUBEO_SUPABASE_URL and a service-role key, then run docs/supabase-news-schema.sql."
      />
    );
  }

  const result = await readNewsForUser(identity, { date });
  return <NewsSummaryCard initial={result} />;
}

async function NewsHistorySection({ date }: { date?: string }) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity || !isSupabaseNewsConfigured()) return null;
  const activeDate = date ?? istDateString();
  return <NewsHistory activeDate={activeDate} />;
}

async function NewsPromptSection() {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity || !isSupabaseNewsConfigured()) return null;

  const state = await readNewsState(identity);
  return (
    <NewsPromptEditor
      initialPrompt={state?.prompt ?? ''}
      initialUpdatedAt={state?.updatedAt ?? null}
    />
  );
}

async function NewsVideos({
  range,
  media,
  duration,
}: {
  range: ReturnType<typeof parseRange>;
  media: ReturnType<typeof parseMediaFilter>;
  duration: ReturnType<typeof parseDurationFilter>;
}) {
  const now = getRequestTime();
  const session = await getSession();
  if (!session?.user) {
    return null;
  }

  const preferences = await getWhitelistedChannelPreferences();
  const newsSpaceNorm = normalizeSpaceName(NEWS_SPACE);
  const newsChannelIds = new Set(
    preferences
      .filter((channel) => normalizeSpaceName(channel.space) === newsSpaceNorm)
      .map((channel) => channel.id),
  );

  if (newsChannelIds.size === 0) {
    return (
      <EmptyState
        emoji="🗂️"
        title={`No channels in the "${NEWS_SPACE}" space yet`}
        description={`Open the Channels page and move your news channels into the "${NEWS_SPACE}" space (case-sensitive). They'll show up here automatically.`}
      />
    );
  }

  let groups;
  try {
    const result = await getChannelGroupedFeedWithQuota(range, media, range === 'all' ? 50 : 12, now);
    groups = result.groups
      .filter((group) => newsChannelIds.has(group.channel.id))
      .map((group) => ({
        ...group,
        videos: group.videos.filter((video) => matchesDurationFilter(video, duration)),
      }));
  } catch (error) {
    return (
      <EmptyState
        emoji="!"
        title="Couldn't load news channel videos"
        description={(error as Error).message}
      />
    );
  }

  const visible = groups.filter((group) => group.videos.length > 0);
  if (visible.length === 0) {
    return (
      <EmptyState
        emoji="📭"
        title="No new videos in this filter"
        description={`Try a longer time window, switch media type, or pick a different duration. Channels in "${NEWS_SPACE}" space: ${newsChannelIds.size}.`}
      />
    );
  }

  return (
    <div className="space-y-8">
      {visible.map((group) => (
        <ChannelRow key={group.channel.id} data={group} now={now} />
      ))}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <section className="space-y-3">
      <div className="h-6 w-64 rounded bg-duo-soft animate-pulse" />
      <div className="card p-5 space-y-3">
        <div className="h-4 w-3/4 rounded bg-duo-soft animate-pulse" />
        <div className="h-4 w-full rounded bg-duo-soft animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-duo-soft animate-pulse" />
        <div className="h-4 w-2/3 rounded bg-duo-soft animate-pulse" />
      </div>
    </section>
  );
}

function VideosSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-duo-soft animate-pulse" />
            <div className="h-5 w-48 rounded bg-duo-soft animate-pulse" />
          </div>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 3 }).map((__, inner) => (
              <div key={inner} className="card w-[300px] shrink-0">
                <div className="aspect-video bg-duo-soft animate-pulse" />
                <div className="space-y-2 p-3">
                  <div className="h-4 rounded bg-duo-soft animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-duo-soft animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
