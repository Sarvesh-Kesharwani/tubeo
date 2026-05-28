import { AddChannelForm } from '@/components/AddChannelForm';
import { AddSpaceForm } from '@/components/AddSpaceForm';
import { ChannelSettingsRow } from '@/components/ChannelSettingsRow';
import { DriveRestoreCard } from '@/components/DriveRestoreCard';
import { NewsYouLearnLibrarySettings } from '@/components/NewsYouLearnLibrarySettings';
import { NewsYouLearnPromptSettings } from '@/components/NewsYouLearnPromptSettings';
import { QuotaCard } from '@/components/QuotaCard';
import { SpaceChannelsList, type SpaceChannelItem } from '@/components/SpaceChannelsList';
import { SpaceSettingsRow } from '@/components/SpaceSettingsRow';
import { SpacesManager, type SpaceItem } from '@/components/SpacesManager';
import { readApiUsageSummaries } from '@/lib/api-usage';
import { readNewsYouLearnState } from '@/lib/news-youlearn-service';
import { getSession } from '@/lib/session';
import {
  getEnvChannelIds,
  getWhitelistedChannelPreferences,
  getWhitelistedChannelSpaces,
} from '@/lib/whitelist';
import { getChannels } from '@/lib/youtube';
import { isInstagramChannelId, instagramUsernameFromChannelId } from '@/lib/instagram';

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
    // Show IDs if API fails
  }

  const usage = canViewQuota ? await readApiUsageSummaries(params?.quotaDate) : null;
  const newsYouLearn = session?.user ? await readNewsYouLearnState(session) : null;

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
    <div suppressHydrationWarning className="max-w-3xl space-y-8">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink flex items-center gap-2">
        <span aria-hidden>⚙️</span> Channels
      </h1>

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

      {session?.user && newsYouLearn && (
        <>
          <NewsYouLearnLibrarySettings initialState={newsYouLearn} />
          <NewsYouLearnPromptSettings initialPrompt={newsYouLearn.prompt} />
        </>
      )}

      <section className="card p-5 space-y-4">
        <h2 className="font-extrabold text-duo-ink">Add a channel</h2>
        <AddChannelForm spaces={spaces} />
      </section>

      <section className="card p-5 space-y-5">
        <div className="space-y-1">
          <h2 className="font-extrabold text-duo-ink">Spaces &amp; channels</h2>
          <p className="text-xs font-bold text-duo-ink/50">
            Drag a space card by its header to reorder spaces. Drag a channel card to reorder it within its space. Rename or delete spaces inline.
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
