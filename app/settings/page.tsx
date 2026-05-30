import { AddChannelForm } from '@/components/AddChannelForm';
import { AddSpaceForm } from '@/components/AddSpaceForm';
import { ChannelSettingsRow } from '@/components/ChannelSettingsRow';
import { DriveRestoreCard } from '@/components/DriveRestoreCard';
import { QuotaCard } from '@/components/QuotaCard';
import { SpaceChannelsList, type SpaceChannelItem } from '@/components/SpaceChannelsList';
import { SpaceSettingsRow } from '@/components/SpaceSettingsRow';
import { SpacesManager, type SpaceItem } from '@/components/SpacesManager';
import { readApiUsageSummaries } from '@/lib/api-usage';
import { isInstagramChannelId, instagramUsernameFromChannelId } from '@/lib/instagram';
import { getSession } from '@/lib/session';
import {
  getEnvChannelIds,
  getWhitelistedChannelPreferences,
  getWhitelistedChannelSpaces,
} from '@/lib/whitelist';
import { getChannels } from '@/lib/youtube';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ quotaDate?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  const [preferences, envIds, spaces] = await Promise.all([
    getWhitelistedChannelPreferences(),
    Promise.resolve(getEnvChannelIds()),
    getWhitelistedChannelSpaces(),
  ]);
  const allIds = preferences.map((channel) => channel.id);
  const youtubeIds = allIds.filter((id) => !isInstagramChannelId(id));
  const quotaViewerEmail = (process.env.YOUTUBE_QUOTA_VIEWER_EMAIL ?? '').trim().toLowerCase();
  const canViewQuota =
    !!quotaViewerEmail && session?.user?.email?.trim().toLowerCase() === quotaViewerEmail;

  let channels: Awaited<ReturnType<typeof getChannels>> = [];
  try {
    channels = await getChannels(youtubeIds);
  } catch {
    // Show IDs if API fails.
  }

  const usage = canViewQuota ? await readApiUsageSummaries(params?.quotaDate) : null;
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  const items: SpaceItem[] = spaces.map((space) => {
    const groupedPreferences = preferences.filter((channel) => channel.space === space);
    const channelItems: SpaceChannelItem[] = groupedPreferences.map((channelPreference) => {
      const isInstagram = isInstagramChannelId(channelPreference.id);
      const username = instagramUsernameFromChannelId(channelPreference.id);
      const channel = isInstagram ? null : channelMap.get(channelPreference.id);
      const fromEnv = envIds.includes(channelPreference.id);
      return {
        id: channelPreference.id,
        fromEnv,
        node: (
          <ChannelSettingsRow
            id={channelPreference.id}
            title={isInstagram ? `@${username}` : channel?.title}
            thumbnail={channel?.thumbnail}
            fromEnv={fromEnv}
            currentSpace={channelPreference.space}
            spaces={spaces}
          />
        ),
      };
    });
    return {
      space,
      count: groupedPreferences.length,
      controls: <SpaceSettingsRow space={space} />,
      channels:
        channelItems.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-duo-border bg-duo-soft/60 px-3 py-2 text-xs font-bold text-duo-mute">
            No channels in this space yet.
          </p>
        ) : (
          <SpaceChannelsList space={space} items={channelItems} />
        ),
    };
  });

  return (
    <div suppressHydrationWarning className="w-full space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-duo-ink">Settings</h1>
          <p className="text-xs font-bold text-duo-mute">
            {preferences.length} channels / {spaces.length} spaces
          </p>
        </div>
      </div>

      {canViewQuota && usage && (
        <QuotaCard
          youtube={usage.youtube}
          deepseek={usage.deepseek}
          resetTimezone={usage.resetTimezone}
          selectedDate={usage.selectedDate}
          availableDates={usage.availableDates}
        />
      )}

      {session?.user && <DriveRestoreCard />}

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-extrabold text-duo-ink">Quick add</h2>
          <span className="chip cursor-default text-[11px]">Channels / spaces</span>
        </div>
        <div className="grid gap-3 xl:grid-cols-[1.35fr_0.85fr]">
          <AddChannelForm spaces={spaces} />
          <AddSpaceForm />
        </div>
      </section>

      <section className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-extrabold text-duo-ink">Spaces &amp; channels</h2>
          <span className="text-xs font-bold text-duo-mute">Drag headers to reorder.</span>
        </div>
        {spaces.length === 0 ? (
          <p className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-5 text-sm font-bold text-duo-mute">
            No spaces yet. Create one above.
          </p>
        ) : (
          <SpacesManager items={items} />
        )}
      </section>
    </div>
  );
}
