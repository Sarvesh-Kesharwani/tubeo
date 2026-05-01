import { Suspense } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { MediaTypeFilter } from '@/components/MediaTypeFilter';
import { MixedFeedClient } from '@/components/MixedFeedClient';
import { QuotaUsageTracker } from '@/components/QuotaUsageTracker';
import { TimeFilter } from '@/components/TimeFilter';
import { ViewPreferenceTracker } from '@/components/ViewPreferenceTracker';
import { getCookieViewPreferences } from '@/lib/channels-cookie';
import { parseMediaFilter } from '@/lib/media';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import { parseRange } from '@/lib/time';
import { getMixedFeedWithQuota } from '@/lib/youtube';
import { getWhitelistedChannelIds } from '@/lib/whitelist';

export default async function MixedPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; media?: string }>;
}) {
  const sp = await searchParams;
  const view = await getCookieViewPreferences();
  const range = parseRange(sp.range ?? view.home.range);
  const media = parseMediaFilter(sp.media ?? view.home.media);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-extrabold text-duo-ink">Mixed feed</h1>
        <Suspense fallback={null}>
          <TimeFilter active={range} />
        </Suspense>
        <Suspense fallback={null}>
          <MediaTypeFilter active={media} />
        </Suspense>
      </section>

      <Suspense key={`${range}:${media}`} fallback={<FeedSkeleton />}>
        <Feed range={range} media={media} />
      </Suspense>
      <ViewPreferenceTracker page="home" range={range} media={media} />
    </div>
  );
}

async function Feed({
  range,
  media,
}: {
  range: ReturnType<typeof parseRange>;
  media: ReturnType<typeof parseMediaFilter>;
}) {
  const now = getRequestTime();
  const session = await getSession();

  if (!session?.user) {
    return (
      <EmptyState
        emoji="TV"
        title="Sign in to view your dashboard"
        description="Tubeo clears your saved feed on logout. Sign in again to load your channels."
      />
    );
  }

  if ((await getWhitelistedChannelIds()).length === 0) {
    return (
      <EmptyState
        emoji="..."
        title="No channels whitelisted yet"
        description="Add channel IDs to WHITELIST_CHANNELS in .env.local (comma-separated)."
      />
    );
  }

  let videos;
  let quotaUnits = 0;
  try {
    const result = await getMixedFeedWithQuota(range, media, 10, now);
    videos = result.videos;
    quotaUnits = result.quota.refreshCost;
  } catch (error) {
    return <EmptyState emoji="!" title="Couldn't load feed" description={(error as Error).message} />;
  }

  if (videos.length === 0) {
    return (
      <EmptyState
        emoji="0"
        title="Nothing new in this filter"
        description="Try a longer time window or switch between videos and shorts."
      />
    );
  }

  return (
    <>
      {session.accessToken && quotaUnits > 0 && (
        <QuotaUsageTracker units={quotaUnits} trackingKey={`home:${range}:${media}:${now}`} />
      )}
      <MixedFeedClient videos={videos} now={now} />
    </>
  );
}

function FeedSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="card">
          <div className="aspect-video bg-duo-soft animate-pulse" />
          <div className="p-3 space-y-2">
            <div className="h-4 bg-duo-soft rounded animate-pulse" />
            <div className="h-3 bg-duo-soft rounded w-2/3 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
