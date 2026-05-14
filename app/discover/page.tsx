import { DiscoverChannelsClient } from '@/components/DiscoverChannelsClient';
import { EmptyState } from '@/components/EmptyState';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { readUserSyncState } from '@/lib/sync-store';

export default async function DiscoverPage() {
  const session = await getSession();
  const cookieStore = await getCookieChannelStore();
  const remote = session?.user ? await readUserSyncState(session).catch(() => ({ state: null })) : { state: null };
  const store = remote.state ?? cookieStore;
  const initialSearches = store.discoverSearches;
  const draft = store.discoverDraft;
  const activeSearchId =
    store.activeDiscoverSearchId ??
    (draft?.q ? initialSearches.find((search) => JSON.stringify(search.filters) === JSON.stringify(draft))?.id : undefined);

  if (!session?.user) {
    return (
      <EmptyState
        emoji="CH"
        title="Sign in to discover channels"
        description="Tubeo saves ignored channels and selected channels to your synced Drive-backed list."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold text-duo-ink sm:text-3xl">Discover channels</h1>
        <p className="max-w-3xl text-sm font-bold text-duo-ink/55">
          Search YouTube channels, select channels to add under Uncategorized, or ignore channels so future searches skip them.
        </p>
      </section>
      <DiscoverChannelsClient
        initialIgnored={store.ignoredChannels}
        initialSearches={initialSearches}
        activeSearchId={activeSearchId}
        initialDraft={draft}
        initialExistingIds={store.channels.map((channel) => channel.id)}
      />
    </div>
  );
}
