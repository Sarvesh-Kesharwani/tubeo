import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { DiscoverHistoryClient } from '@/components/DiscoverHistoryClient';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { readUserSyncState } from '@/lib/sync-store';

export default async function DiscoverHistoryPage() {
  const session = await getSession();
  const cookieStore = await getCookieChannelStore();
  const remote = session?.user ? await readUserSyncState(session).catch(() => ({ state: null })) : { state: null };
  const store = remote.state ?? cookieStore;

  if (!session?.user) {
    return (
      <EmptyState
        emoji="SR"
        title="Sign in to view search history"
        description="Tubeo saves search history into your synced account state."
      />
    );
  }

  const existingIds = store.channels.map((channel) => channel.id);
  const ignoredIds = store.ignoredChannels.map((channel) => channel.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-duo-ink sm:text-3xl">Previous searches</h1>
          <p className="mt-1 text-sm font-bold text-duo-ink/55">
            Saved keywords, filters, sorting, pages, and results. Select or ignore channels from cached pages without spending YouTube quota again.
          </p>
        </div>
        <Link href="/discover" className="btn-duo-green px-3 py-2 text-xs">
          Back to discover
        </Link>
      </div>

      {store.discoverSearches.length === 0 ? (
        <EmptyState emoji="0" title="No saved searches yet" description="Run a search on Discover first." />
      ) : (
        <DiscoverHistoryClient
          searches={store.discoverSearches}
          activeSearchId={store.activeDiscoverSearchId}
          initialExistingIds={existingIds}
          initialIgnoredIds={ignoredIds}
        />
      )}
    </div>
  );
}
