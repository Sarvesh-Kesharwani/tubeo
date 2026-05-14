import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { readUserSyncState } from '@/lib/sync-store';
import type { DiscoverSearchFilters } from '@/lib/types';

function paramsText(filters: DiscoverSearchFilters) {
  return [
    `sort: ${filters.order || 'relevance'}`,
    filters.regionCode ? `region: ${filters.regionCode}` : 'region: any',
    filters.relevanceLanguage ? `language: ${filters.relevanceLanguage}` : 'language: any',
    `safe: ${filters.safeSearch || 'moderate'}`,
    `type: ${filters.channelType || 'any'}`,
    filters.topicId ? `topic: ${filters.topicId}` : '',
    filters.publishedAfter ? `after: ${filters.publishedAfter.slice(0, 10)}` : '',
    filters.publishedBefore ? `before: ${filters.publishedBefore.slice(0, 10)}` : '',
  ].filter(Boolean);
}

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-duo-ink sm:text-3xl">Previous searches</h1>
          <p className="mt-1 text-sm font-bold text-duo-ink/55">Saved keywords, filters, sorting, pages, and results.</p>
        </div>
        <Link href="/discover" className="btn-duo-green px-3 py-2 text-xs">
          Back to discover
        </Link>
      </div>

      {store.discoverSearches.length === 0 ? (
        <EmptyState emoji="0" title="No saved searches yet" description="Run a search on Discover first." />
      ) : (
        <div className="space-y-4">
          {store.discoverSearches.map((search) => (
            <details key={search.id} className="card p-4" open={search.id === store.activeDiscoverSearchId}>
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <h2 className="text-lg font-extrabold text-duo-ink">{search.filters.q}</h2>
                    <div className="flex flex-wrap gap-2">
                      {paramsText(search.filters).map((item) => (
                        <span key={item} className="chip cursor-default text-xs">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-xs font-extrabold text-duo-ink/50">
                    <p>{search.pages.length} pages</p>
                    <p>{new Date(search.updatedAt).toLocaleString()}</p>
                  </div>
                </div>
              </summary>

              <div className="mt-4 space-y-4 border-t-2 border-duo-border pt-4">
                {search.pages.map((page) => (
                  <section key={page.pageNumber} className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-extrabold text-duo-ink">Page {page.pageNumber}</h3>
                      <span className="chip cursor-default text-xs">{page.channels.length} channels</span>
                      <span className="chip cursor-default text-xs">{page.hiddenIgnored} ignored hidden</span>
                      <span className="chip cursor-default text-xs">{page.quotaUnits} quota units</span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {page.channels.map((channel) => (
                        <div key={channel.id} className="rounded-2xl border-2 border-duo-border bg-duo-soft/50 p-3">
                          <div className="flex items-center gap-3">
                            {channel.thumbnail ? (
                              <img src={channel.thumbnail} alt="" className="h-10 w-10 rounded-full object-cover" />
                            ) : (
                              <div className="h-10 w-10 rounded-full bg-white" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-extrabold text-duo-ink">{channel.title}</p>
                              <p className="truncate text-xs font-bold text-duo-ink/45">{channel.id}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
