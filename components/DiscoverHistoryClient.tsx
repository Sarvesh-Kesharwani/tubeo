'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiscoverSearchFilters, DiscoverSearchRecord, DiscoveredChannel } from '@/lib/types';
import { DiscoverChannelCard, channelPayload, type TopVideo } from './DiscoverChannelCard';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

function paramsText(filters: DiscoverSearchFilters): string[] {
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

export function DiscoverHistoryClient({
  searches,
  activeSearchId,
  initialExistingIds,
  initialIgnoredIds,
}: {
  searches: DiscoverSearchRecord[];
  activeSearchId?: string;
  initialExistingIds: string[];
  initialIgnoredIds: string[];
}) {
  const router = useRouter();
  const [existingIds, setExistingIds] = useState<string[]>(initialExistingIds);
  const [ignoredIds, setIgnoredIds] = useState<string[]>(initialIgnoredIds);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [statsWorkingId, setStatsWorkingId] = useState<string | null>(null);
  const [topWorkingId, setTopWorkingId] = useState<string | null>(null);
  const [topVideos, setTopVideos] = useState<Record<string, TopVideo[]>>({});
  const [statsById, setStatsById] = useState<
    Record<string, { subscriberCount?: number; viewCount?: number; videoCount?: number; country?: string }>
  >({});
  const [deletingSearchId, setDeletingSearchId] = useState<string | null>(null);
  const [deletedSearchIds, setDeletedSearchIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function deleteSearch(searchId: string, label: string) {
    if (!window.confirm(`Delete saved search "${label || searchId}"? This can't be undone.`)) {
      return;
    }
    setDeletingSearchId(searchId);
    setError(null);
    try {
      const response = await fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'deleteDiscoverSearch', searchId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Delete failed.');
        return;
      }
      setDeletedSearchIds((current) => {
        const next = new Set(current);
        next.add(searchId);
        return next;
      });
      router.refresh();
    } catch {
      setError('Delete failed.');
    } finally {
      setDeletingSearchId(null);
    }
  }

  const existingSet = useMemo(() => new Set(existingIds), [existingIds]);
  const ignoredSet = useMemo(() => new Set(ignoredIds), [ignoredIds]);

  async function mutate(type: 'acceptDiscoveredChannel' | 'ignoreDiscoveredChannel', channel: DiscoveredChannel) {
    setWorkingId(channel.id);
    setError(null);
    try {
      const response = await fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, channel: channelPayload(channel) }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Action failed.');
        return;
      }
      if (type === 'acceptDiscoveredChannel') {
        setExistingIds((current) => [...new Set([...current, channel.id])]);
        setIgnoredIds((current) => current.filter((id) => id !== channel.id));
      } else {
        setIgnoredIds((current) => [...new Set([...current, channel.id])]);
        setExistingIds((current) => current.filter((id) => id !== channel.id));
      }
      router.refresh();
      window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
    } catch {
      setError('Action failed.');
    } finally {
      setWorkingId(null);
    }
  }

  async function fetchStats(channelId: string) {
    setStatsWorkingId(channelId);
    setError(null);
    try {
      const response = await fetch(`/api/discover/channels/${encodeURIComponent(channelId)}/stats`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Stats fetch failed.');
        return;
      }
      setStatsById((current) => ({
        ...current,
        [channelId]: {
          subscriberCount: data.subscriberCount,
          viewCount: data.viewCount,
          videoCount: data.videoCount,
          country: data.country,
        },
      }));
      if (Number(data.quotaUnits ?? 0) > 0) window.dispatchEvent(new CustomEvent('tubeo-quota-updated'));
    } catch {
      setError('Stats fetch failed.');
    } finally {
      setStatsWorkingId(null);
    }
  }

  async function fetchTopVideos(channelId: string) {
    setTopWorkingId(channelId);
    setError(null);
    try {
      const response = await fetch(
        `/api/discover/channels/${encodeURIComponent(channelId)}/top-videos?limit=3`,
        { cache: 'no-store' },
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Top videos fetch failed.');
        return;
      }
      setTopVideos((current) => ({ ...current, [channelId]: data.videos ?? [] }));
      if (Number(data.quotaUnits ?? 0) > 0) window.dispatchEvent(new CustomEvent('tubeo-quota-updated'));
    } catch {
      setError('Top videos fetch failed.');
    } finally {
      setTopWorkingId(null);
    }
  }

  function mergeChannel(channel: DiscoveredChannel): DiscoveredChannel {
    const stats = statsById[channel.id];
    if (!stats) return channel;
    return {
      ...channel,
      subscriberCount: stats.subscriberCount ?? channel.subscriberCount,
      viewCount: stats.viewCount ?? channel.viewCount,
      videoCount: stats.videoCount ?? channel.videoCount,
      country: stats.country ?? channel.country,
    };
  }

  const visibleSearches = searches.filter((search) => !deletedSearchIds.has(search.id));

  return (
    <div className="space-y-4">
      {error && <p className="text-sm font-extrabold text-red-500">{error}</p>}
      {visibleSearches.map((search) => (
        <details key={search.id} className="card p-4" open={search.id === activeSearchId}>
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
              <div className="flex flex-col items-end gap-2">
                <div className="text-right text-xs font-extrabold text-duo-ink/50">
                  <p>{search.pages.length} pages</p>
                  <p>{new Date(search.updatedAt).toLocaleString()}</p>
                </div>
                <button
                  type="button"
                  className="btn-duo-ghost px-3 py-2 text-xs text-red-500"
                  disabled={deletingSearchId === search.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void deleteSearch(search.id, search.filters.q);
                  }}
                  title="Delete this saved search"
                >
                  {deletingSearchId === search.id ? '...' : 'Delete'}
                </button>
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
                <div className="space-y-3">
                  {page.channels.map((rawChannel) => {
                    const channel = mergeChannel(rawChannel);
                    const isIgnored = ignoredSet.has(channel.id);
                    if (isIgnored) {
                      return (
                        <article
                          key={`${search.id}-${page.pageNumber}-${channel.id}`}
                          className="card p-4 opacity-60"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            {channel.thumbnail ? (
                              <img src={channel.thumbnail} alt="" className="h-12 w-12 rounded-2xl object-cover" />
                            ) : (
                              <div className="h-12 w-12 rounded-2xl bg-duo-soft" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-extrabold text-duo-ink">{channel.title}</p>
                              <p className="text-xs font-bold text-duo-ink/55">Ignored from future searches.</p>
                            </div>
                            <button
                              className="btn-duo-ghost px-3 py-2 text-xs"
                              disabled={workingId === channel.id}
                              onClick={() => void mutate('acceptDiscoveredChannel', channel)}
                            >
                              {workingId === channel.id ? '...' : 'Select instead'}
                            </button>
                          </div>
                        </article>
                      );
                    }
                    return (
                      <DiscoverChannelCard
                        key={`${search.id}-${page.pageNumber}-${channel.id}`}
                        channel={channel}
                        selected={existingSet.has(channel.id)}
                        working={workingId === channel.id}
                        statsWorking={statsWorkingId === channel.id}
                        topWorking={topWorkingId === channel.id}
                        topVideos={topVideos[channel.id]}
                        onFetchStats={() => void fetchStats(channel.id)}
                        onFetchTopVideos={() => void fetchTopVideos(channel.id)}
                        onAccept={() => void mutate('acceptDiscoveredChannel', channel)}
                        onIgnore={() => void mutate('ignoreDiscoveredChannel', channel)}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
