import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { readUserSyncState } from '@/lib/sync-store';

export default async function DiscoverListsPage() {
  const session = await getSession();
  const cookieStore = await getCookieChannelStore();
  const remote = session?.user ? await readUserSyncState(session).catch(() => ({ state: null })) : { state: null };
  const store = remote.state ?? cookieStore;
  const titleById = new Map<string, { title: string; thumbnail: string }>();

  for (const search of store.discoverSearches) {
    for (const page of search.pages) {
      for (const channel of page.channels) {
        if (!titleById.has(channel.id)) {
          titleById.set(channel.id, { title: channel.title, thumbnail: channel.thumbnail });
        }
      }
    }
  }

  if (!session?.user) {
    return (
      <EmptyState
        emoji="CH"
        title="Sign in to view channel lists"
        description="Tubeo saves allowed and ignored channels into your synced account state."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-duo-ink sm:text-3xl">Blocked / allowed</h1>
          <p className="mt-1 text-sm font-bold text-duo-ink/55">Channels selected for future feeds and channels hidden from future searches.</p>
        </div>
        <Link href="/discover" className="btn-duo-green px-3 py-2 text-xs">
          Back to discover
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-extrabold text-duo-ink">Allowed channels</h2>
            <span className="chip cursor-default">{store.channels.length}</span>
          </div>
          {store.channels.length === 0 ? (
            <p className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-5 text-sm font-bold text-duo-mute">
              No allowed channels yet.
            </p>
          ) : (
            <div className="space-y-2">
              {store.channels.map((channel) => {
                const meta = titleById.get(channel.id);
                return (
                  <div key={channel.id} className="rounded-2xl border-2 border-duo-border bg-duo-soft/50 p-3">
                    <div className="flex items-center gap-3">
                      {meta?.thumbnail ? (
                        <img src={meta.thumbnail} alt="" className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-white" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-duo-ink">{meta?.title ?? channel.id}</p>
                        <p className="truncate text-xs font-bold text-duo-ink/45">{channel.space}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-extrabold text-duo-ink">Blocked channels</h2>
            <span className="chip cursor-default">{store.ignoredChannels.length}</span>
          </div>
          {store.ignoredChannels.length === 0 ? (
            <p className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-5 text-sm font-bold text-duo-mute">
              No blocked channels yet.
            </p>
          ) : (
            <div className="space-y-2">
              {store.ignoredChannels.map((channel) => (
                <div key={channel.id} className="rounded-2xl border-2 border-duo-border bg-duo-soft/50 p-3">
                  <div className="flex items-center gap-3">
                    {channel.thumbnail ? (
                      <img src={channel.thumbnail} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-white" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-duo-ink">{channel.title}</p>
                      <p className="truncate text-xs font-bold text-duo-ink/45">{channel.id}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
