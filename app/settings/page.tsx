import { AddChannelForm } from '@/components/AddChannelForm';
import { AddSpaceForm } from '@/components/AddSpaceForm';
import { ChannelSettingsRow } from '@/components/ChannelSettingsRow';
import { DriveRestoreCard } from '@/components/DriveRestoreCard';
import { QuotaCard } from '@/components/QuotaCard';
import { SpaceSettingsRow } from '@/components/SpaceSettingsRow';
import { SpacesManager, type SpaceItem } from '@/components/SpacesManager';
import { getSession } from '@/lib/session';
import {
  getEnvChannelIds,
  getWhitelistedChannelPreferences,
  getWhitelistedChannelSpaces,
} from '@/lib/whitelist';
import { getChannels, getYouTubeQuotaSummary } from '@/lib/youtube';

export default async function SettingsPage() {
  const session = await getSession();
  const [preferences, envIds, spaces] = await Promise.all([
    getWhitelistedChannelPreferences(),
    Promise.resolve(getEnvChannelIds()),
    getWhitelistedChannelSpaces(),
  ]);
  const allIds = preferences.map((channel) => channel.id);
  const quotaViewerEmail = (process.env.YOUTUBE_QUOTA_VIEWER_EMAIL ?? '').trim().toLowerCase();
  const canViewQuota =
    !!quotaViewerEmail && session?.user?.email?.trim().toLowerCase() === quotaViewerEmail;

  let channels: Awaited<ReturnType<typeof getChannels>> = [];
  try {
    channels = await getChannels(allIds);
  } catch {
    // Show IDs if API fails
  }

  const quota = canViewQuota ? await getYouTubeQuotaSummary(allIds.length, session?.accessToken) : null;

  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));

  const items: SpaceItem[] = spaces.map((space) => {
    const groupedPreferences = preferences.filter((channel) => channel.space === space);
    return {
      space,
      count: groupedPreferences.length,
      controls: <SpaceSettingsRow space={space} />,
      channels:
        groupedPreferences.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-duo-border bg-duo-soft/60 px-3 py-2 text-xs font-bold text-duo-mute">
            No channels in this space yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {groupedPreferences.map((channelPreference) => {
              const channel = channelMap.get(channelPreference.id);
              return (
                <ChannelSettingsRow
                  key={channelPreference.id}
                  id={channelPreference.id}
                  title={channel?.title}
                  thumbnail={channel?.thumbnail}
                  fromEnv={envIds.includes(channelPreference.id)}
                  currentSpace={channelPreference.space}
                  spaces={spaces}
                />
              );
            })}
          </ul>
        ),
    };
  });

  return (
    <div suppressHydrationWarning className="max-w-3xl space-y-8">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink flex items-center gap-2">
        <span aria-hidden>⚙️</span> Channels
      </h1>

      {canViewQuota && quota && <QuotaCard quota={quota} />}

      {session?.user && <DriveRestoreCard />}

      <section className="card p-5 space-y-4">
        <h2 className="font-extrabold text-duo-ink">Add a channel</h2>
        <AddChannelForm />
      </section>

      <section className="card p-5 space-y-5">
        <div className="space-y-1">
          <h2 className="font-extrabold text-duo-ink">Spaces &amp; channels</h2>
          <p className="text-xs font-bold text-duo-ink/50">
            Drag a space card by its header to reorder. Rename or delete spaces inline. Channels in each space stay grouped here.
          </p>
        </div>
        <AddSpaceForm />
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
