import { Suspense } from 'react';
import { ChannelRow } from '@/components/ChannelRow';
import { EmptyState } from '@/components/EmptyState';
import { MediaTypeFilter } from '@/components/MediaTypeFilter';
import { TimeFilter } from '@/components/TimeFilter';
import { UpdatesChannelSelector } from '@/components/UpdatesChannelSelector';
import { ViewPreferenceTracker } from '@/components/ViewPreferenceTracker';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { parseMediaFilter } from '@/lib/media';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import { parseRange } from '@/lib/time';
import { getChannels, getLatestVideosForChannel } from '@/lib/youtube';

export default async function UpdatesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; media?: string }>;
}) {
  const sp = await searchParams;
  const store = await getCookieChannelStore();
  const range = parseRange(sp.range ?? store.view.updates.range);
  const media = parseMediaFilter(sp.media ?? store.view.updates.media);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-extrabold text-duo-ink">Updates</h1>
        <Suspense fallback={null}>
          <UpdatesHeader selectedIds={store.updatesChannelIds} />
        </Suspense>
        <Suspense fallback={null}>
          <TimeFilter active={range} />
        </Suspense>
        <Suspense fallback={null}>
          <MediaTypeFilter active={media} />
        </Suspense>
      </section>

      <Suspense key={`${range}:${media}:${store.updatesChannelIds.join(',')}`} fallback={<UpdatesSkeleton />}>
        <UpdatesFeed range={range} media={media} selectedIds={store.updatesChannelIds} />
      </Suspense>
      <ViewPreferenceTracker page="updates" range={range} media={media} />
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
  selectedIds,
}: {
  range: ReturnType<typeof parseRange>;
  media: ReturnType<typeof parseMediaFilter>;
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
  const channels = await getChannels(selectedIds);
  const groups = await Promise.all(
    channels.map(async (channel) => ({
      channel,
      videos: await getLatestVideosForChannel(channel, range, media, range === 'all' ? 50 : 12, now),
    })),
  );

  return (
    <div className="space-y-8">
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
