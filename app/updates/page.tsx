import { Suspense } from 'react';
import { ChannelRow } from '@/components/ChannelRow';
import { DurationFilter } from '@/components/DurationFilter';
import { EmptyState } from '@/components/EmptyState';
import { MediaTypeFilter } from '@/components/MediaTypeFilter';
import { RefreshButton } from '@/components/RefreshButton';
import { TimeFilter } from '@/components/TimeFilter';
import { UpdatesChannelSelector } from '@/components/UpdatesChannelSelector';
import { ViewPreferenceTracker } from '@/components/ViewPreferenceTracker';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { matchesDurationFilter, parseDurationFilter } from '@/lib/duration';
import { parseMediaFilter } from '@/lib/media';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import { parseRange } from '@/lib/time';
import { getChannels, getLatestVideosForChannel } from '@/lib/youtube';

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; media?: string; duration?: string }>;
}) {
  const sp = await searchParams;
  const store = await getCookieChannelStore();
  const range = parseRange(sp.range ?? store.view.updates.range);
  const media = parseMediaFilter(sp.media ?? store.view.updates.media);
  const duration = parseDurationFilter(sp.duration ?? store.view.updates.duration);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink">Updates</h1>
          <RefreshButton paths={['/updates']} hint="Fetch latest videos from YouTube" />
        </div>
        <Suspense fallback={null}>
          <UpdatesHeader selectedIds={store.updatesChannelIds} />
        </Suspense>
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

      <Suspense
        key={`${range}:${media}:${duration}:${store.updatesChannelIds.join(',')}`}
        fallback={<UpdatesSkeleton />}
      >
        <UpdatesFeed range={range} media={media} duration={duration} selectedIds={store.updatesChannelIds} />
      </Suspense>
      <ViewPreferenceTracker page="updates" range={range} media={media} duration={duration} />
    </div>
  );
}

async function UpdatesHeader({ selectedIds }: { selectedIds: string[] }) {
  const store = await getCookieChannelStore();
  const channels = await getChannels(store.channels.map((channel) => channel.id));
  return <UpdatesChannelSelector channels={channels} selectedIds={selectedIds} />;
}

async function UpdatesFeed({
  range,
  media,
  duration,
  selectedIds,
}: {
  range: ReturnType<typeof parseRange>;
  media: ReturnType<typeof parseMediaFilter>;
  duration: ReturnType<typeof parseDurationFilter>;
  selectedIds: string[];
}) {
  const session = await getSession();
  if (!session?.user) {
    return <EmptyState emoji="TV" title="Sign in to view updates" description="Your morning updates sync with Tubeo." />;
  }

  if (selectedIds.length === 0) {
    return (
      <EmptyState
        emoji="0"
        title="No update channels selected"
        description="Open Updates channels and pick the channels you want to check every morning."
      />
    );
  }

  const now = getRequestTime();
  let channels;
  try {
    channels = await getChannels(selectedIds);
  } catch (error) {
    return (
      <EmptyState
        emoji="!"
        title="Couldn't load updates"
        description={(error as Error).message}
      />
    );
  }

  const settled = await Promise.allSettled(
    channels.map(async (channel) => ({
      channel,
      videos: (await getLatestVideosForChannel(channel, range, media, range === 'all' ? 50 : 12, now)).filter(
        (video) => matchesDurationFilter(video, duration),
      ),
    })),
  );

  const groups = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const failureCount = settled.length - groups.length;
  const firstFailure = settled.find((result) => result.status === 'rejected') as
    | PromiseRejectedResult
    | undefined;

  if (groups.length === 0) {
    return (
      <EmptyState
        emoji="!"
        title="Couldn't load updates"
        description={
          (firstFailure?.reason as Error | undefined)?.message ??
          'YouTube returned errors for every channel. The daily API quota may be exhausted.'
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      {failureCount > 0 && (
        <div className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/50 px-4 py-3 text-sm font-semibold text-duo-mute">
          {`Couldn't fetch ${failureCount} of ${settled.length} channel${settled.length === 1 ? '' : 's'} — showing what we could load.`}
        </div>
      )}
      {groups.map((group) => (
        <ChannelRow key={group.channel.id} data={group} now={now} />
      ))}
    </div>
  );
}

function UpdatesSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-40 rounded-chonk bg-duo-soft animate-pulse" />
      ))}
    </div>
  );
}
