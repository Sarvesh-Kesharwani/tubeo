import { Suspense } from 'react';
import { DurationFilter } from '@/components/DurationFilter';
import { EmptyState } from '@/components/EmptyState';
import { InstagramChannelRow } from '@/components/InstagramChannelRow';
import { MediaTypeFilter } from '@/components/MediaTypeFilter';
import { QuotaUsageTracker } from '@/components/QuotaUsageTracker';
import { SpaceVideoBuckets } from '@/components/SpaceVideoBuckets';
import { SpaceTabs } from '@/components/SpaceTabs';
import { TimeFilter } from '@/components/TimeFilter';
import { ViewPreferenceTracker } from '@/components/ViewPreferenceTracker';
import { getCookieViewPreferences } from '@/lib/channels-cookie';
import { matchesDurationFilter, parseDurationFilter } from '@/lib/duration';
import { parseMediaFilter } from '@/lib/media';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import {
  DEFAULT_INSTAGRAM_CHANNEL,
  instagramUsernameFromChannelId,
  isInstagramChannelId,
  getInstagramChannelReels,
} from '@/lib/instagram';
import { parseRange } from '@/lib/time';
import { CHANNELS_OVERVIEW_SPACE, DEFAULT_CHANNEL_SPACE } from '@/lib/types';
import type { ChannelWithVideos } from '@/lib/types';
import { getChannelGroupedFeedWithQuota } from '@/lib/youtube';
import { getWhitelistedChannelPreferences, getWhitelistedChannelSpaces } from '@/lib/whitelist';

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; space?: string; media?: string; duration?: string }>;
}) {
  const sp = await searchParams;
  const view = await getCookieViewPreferences();
  const range = parseRange(sp.range ?? view.channels.range);
  const activeSpace = (sp.space ?? view.channels.space ?? '').trim();
  const media = parseMediaFilter(sp.media ?? view.channels.media);
  const duration = parseDurationFilter(sp.duration ?? view.channels.duration);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink">Channels</h1>
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

      <Suspense key={`${range}:${activeSpace || 'all'}:${media}:${duration}`} fallback={<GroupedSkeleton />}>
        <Grouped range={range} activeSpace={activeSpace} media={media} duration={duration} />
      </Suspense>
    </div>
  );
}

async function Grouped({
  range,
  activeSpace,
  media,
  duration,
}: {
  range: ReturnType<typeof parseRange>;
  activeSpace: string;
  media: ReturnType<typeof parseMediaFilter>;
  duration: ReturnType<typeof parseDurationFilter>;
}) {
  const now = getRequestTime();
  const session = await getSession();

  if (!session?.user) {
    return (
      <EmptyState
        emoji="TV"
        title="Sign in to view your channels"
        description="Tubeo clears your saved feed on logout. Sign in again to load your channels."
      />
    );
  }

  const [preferences, savedSpaces] = await Promise.all([
    getWhitelistedChannelPreferences(),
    getWhitelistedChannelSpaces(),
  ]);
  const spaceById = new Map(preferences.map((channel) => [channel.id, channel.space]));
  const orderedSpaces = [...new Set(savedSpaces.map((space) => space || DEFAULT_CHANNEL_SPACE))];

  let groups;
  let quotaUnits = 0;
  const instagramPreferences = preferences.filter((channel) => isInstagramChannelId(channel.id));
  const instagramChannels =
    instagramPreferences.length > 0
      ? instagramPreferences
      : [{ id: `ig:${DEFAULT_INSTAGRAM_CHANNEL.username}`, space: DEFAULT_CHANNEL_SPACE }];
  let instagramResults: Array<{
    id: string;
    username: string;
    space: string;
    result: Awaited<ReturnType<typeof getInstagramChannelReels>>;
  }> = [];
  try {
    const perChannel = range === 'all' ? 50 : 12;
    const [result, resolvedInstagram] = await Promise.all([
      getChannelGroupedFeedWithQuota(range, media, perChannel, now),
      media === 'videos'
        ? Promise.resolve([])
        : Promise.all(
            instagramChannels.map(async (channel) => {
              const username = instagramUsernameFromChannelId(channel.id);
              return {
                id: channel.id,
                username,
                space: channel.space,
                result: await getInstagramChannelReels(username, 5),
              };
            }),
          ),
    ]);
    groups = result.groups.map((group) => ({
      ...group,
      videos: group.videos.filter((video) => matchesDurationFilter(video, duration)),
    }));
    quotaUnits = result.quota.refreshCost;
    instagramResults = resolvedInstagram;
  } catch (error) {
    return <EmptyState emoji="!" title="Couldn't load channels" description={(error as Error).message} />;
  }

  const youtubePreferences = preferences.filter((channel) => !isInstagramChannelId(channel.id));
  const groupedWithSpace = groups.map((group) => ({
    ...group,
    space: spaceById.get(group.channel.id) ?? DEFAULT_CHANNEL_SPACE,
  }));
  const missingGroups = youtubePreferences
    .filter((channel) => !groupedWithSpace.some((group) => group.channel.id === channel.id))
    .map((channel) => ({
      channel: {
        id: channel.id,
        title: channel.id,
        thumbnail: '',
        uploadsPlaylistId: '',
      },
      videos: [],
      space: channel.space,
    }));
  const visibleGroups = [...groupedWithSpace, ...missingGroups];

  const activeSpaceValue =
    activeSpace && activeSpace !== DEFAULT_CHANNEL_SPACE && orderedSpaces.includes(activeSpace)
      ? activeSpace
      : CHANNELS_OVERVIEW_SPACE;
  const filteredGroups =
    activeSpaceValue === CHANNELS_OVERVIEW_SPACE
      ? visibleGroups
      : visibleGroups.filter((group) => group.space === activeSpaceValue);

  const instagramCountForSpace = (space: string) =>
    instagramChannels.filter((channel) => channel.space === space).length;
  const visibleInstagramResults = instagramResults.filter(
    (item) =>
      activeSpaceValue === CHANNELS_OVERVIEW_SPACE ||
      item.space === activeSpaceValue ||
      (!item.space && activeSpaceValue === DEFAULT_CHANNEL_SPACE),
  );
  const countVideos = (spaceGroups: ChannelWithVideos[]) =>
    spaceGroups.reduce((sum, group) => sum + group.videos.length, 0);
  const groupsForSpace = (space: string) => visibleGroups.filter((group) => group.space === space);

  const tabs = [
    {
      value: CHANNELS_OVERVIEW_SPACE,
      label: DEFAULT_CHANNEL_SPACE,
      count: countVideos(visibleGroups) + instagramChannels.length,
    },
    ...orderedSpaces.filter((space) => space !== DEFAULT_CHANNEL_SPACE).map((space) => ({
      value: space,
      label: space,
      count: countVideos(groupsForSpace(space)) + instagramCountForSpace(space),
    })),
  ];

  return (
    <div className="space-y-6">
      {session.accessToken && quotaUnits > 0 && (
        <QuotaUsageTracker
          units={quotaUnits}
          trackingKey={`channels:${range}:${activeSpaceValue}:${media}:${duration}:${now}`}
        />
      )}
      <ViewPreferenceTracker
        page="channels"
        range={range}
        media={media}
        duration={duration}
        space={activeSpaceValue}
      />
      <SpaceTabs activeSpace={activeSpaceValue} tabs={tabs} />

      {visibleInstagramResults.map((item) => (
          <InstagramChannelRow
            key={item.id}
            title={item.username}
            url={`https://www.instagram.com/${item.username}/reels/`}
            reels={item.result.reels}
            error={item.result.error}
            now={now}
          />
        ))}

      {activeSpaceValue === CHANNELS_OVERVIEW_SPACE ? (
        <div className="space-y-4">
          {orderedSpaces.map((space) => {
            const spaceGroups = groupsForSpace(space);
            const videoCount = countVideos(spaceGroups);

            return (
              <details
                key={space}
                open={space === DEFAULT_CHANNEL_SPACE || spaceGroups.length > 0}
                className="card overflow-hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-extrabold text-duo-ink">
                  <span>{space}</span>
                  <span className="chip cursor-default">{videoCount}</span>
                </summary>

                <div className="border-t-2 border-duo-border px-4 py-4">
                  <SpaceVideoBuckets groups={spaceGroups} now={now} />
                </div>
              </details>
            );
          })}
        </div>
      ) : filteredGroups.length === 0 && visibleInstagramResults.length === 0 ? (
        <EmptyState
          emoji="0"
          title="No channels in this filter"
          description="Move channels into this space or switch between videos and shorts."
        />
      ) : (
        <SpaceVideoBuckets groups={filteredGroups} now={now} />
      )}
    </div>
  );
}

function GroupedSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-duo-soft animate-pulse" />
            <div className="h-5 w-48 bg-duo-soft rounded animate-pulse" />
          </div>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 3 }).map((__, innerIndex) => (
              <div key={innerIndex} className="card w-[300px] shrink-0">
                <div className="aspect-video bg-duo-soft animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-duo-soft rounded animate-pulse" />
                  <div className="h-3 bg-duo-soft rounded w-2/3 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
