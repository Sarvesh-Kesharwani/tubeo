'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { DiscoveredChannel } from '@/lib/types';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

type SearchState = {
  channels: DiscoveredChannel[];
  ignoredChannels: DiscoveredChannel[];
  existingIds: string[];
  nextPageToken?: string;
  hiddenIgnored: number;
  quotaUnits: number;
  error?: string;
};

const EMPTY_STATE: SearchState = {
  channels: [],
  ignoredChannels: [],
  existingIds: [],
  hiddenIgnored: 0,
  quotaUnits: 0,
};

const REGION_OPTIONS = [
  { value: '', label: 'Any region' },
  { value: 'IN', label: 'India' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
];

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Any language' },
  { value: 'hi', label: 'Hindi' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
];

const TOPIC_OPTIONS = [
  { value: '', label: 'Any topic' },
  { value: '/m/04rlf', label: 'Music' },
  { value: '/m/0bzvm2', label: 'Gaming' },
  { value: '/m/06ntj', label: 'Sports' },
  { value: '/m/02jjt', label: 'Entertainment' },
  { value: '/m/019_rr', label: 'Lifestyle' },
  { value: '/m/07c1v', label: 'Technology' },
  { value: '/m/09s1f', label: 'Business' },
  { value: '/m/0kt51', label: 'Health' },
  { value: '/m/01k8wb', label: 'Knowledge' },
];

function formatCount(value: number | undefined): string {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function channelPayload(channel: DiscoveredChannel) {
  return {
    id: channel.id,
    title: channel.title,
    thumbnail: channel.thumbnail,
    description: channel.description,
    subscriberCount: channel.subscriberCount,
    viewCount: channel.viewCount,
    videoCount: channel.videoCount,
    country: channel.country,
  };
}

export function DiscoverChannelsClient({ initialIgnored }: { initialIgnored: DiscoveredChannel[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('relevance');
  const [regionCode, setRegionCode] = useState('IN');
  const [relevanceLanguage, setRelevanceLanguage] = useState('en');
  const [safeSearch, setSafeSearch] = useState('moderate');
  const [channelType, setChannelType] = useState('any');
  const [topicId, setTopicId] = useState('');
  const [publishedAfter, setPublishedAfter] = useState('');
  const [publishedBefore, setPublishedBefore] = useState('');
  const [state, setState] = useState<SearchState>({ ...EMPTY_STATE, ignoredChannels: initialIgnored });
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [statsWorkingId, setStatsWorkingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentIds = useMemo(() => new Set(state.existingIds), [state.existingIds]);

  useEffect(() => {
    setState((current) => ({ ...current, ignoredChannels: initialIgnored }));
  }, [initialIgnored]);

  async function runSearch(pageToken?: string) {
    if (!query.trim()) {
      setState((current) => ({ ...current, channels: [], error: 'Enter a keyword first.' }));
      return;
    }

    const params = new URLSearchParams({
      q: query.trim(),
      order,
      safeSearch,
      channelType,
    });
    if (regionCode) params.set('regionCode', regionCode);
    if (relevanceLanguage) params.set('relevanceLanguage', relevanceLanguage);
    if (topicId) params.set('topicId', topicId);
    if (publishedAfter) params.set('publishedAfter', new Date(`${publishedAfter}T00:00:00Z`).toISOString());
    if (publishedBefore) params.set('publishedBefore', new Date(`${publishedBefore}T23:59:59Z`).toISOString());
    if (pageToken) params.set('pageToken', pageToken);

    setState((current) => ({ ...current, error: undefined }));
    startTransition(async () => {
      try {
        const response = await fetch(`/api/discover/channels?${params}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          setState((current) => ({ ...current, error: data.error ?? 'Search failed.' }));
          return;
        }
        setState({
          channels: data.channels ?? [],
          ignoredChannels: data.ignoredChannels ?? [],
          existingIds: data.existingIds ?? [],
          nextPageToken: data.nextPageToken,
          hiddenIgnored: data.hiddenIgnored ?? 0,
          quotaUnits: data.quotaUnits ?? 0,
        });
      } catch {
        setState((current) => ({ ...current, error: 'Search failed.' }));
      }
    });
  }

  async function mutate(type: 'acceptDiscoveredChannel' | 'ignoreDiscoveredChannel', channel: DiscoveredChannel) {
    setWorkingId(channel.id);
    try {
      const response = await fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, channel: channelPayload(channel) }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setState((current) => ({ ...current, error: data.error ?? 'Action failed.' }));
        return;
      }

      if (type === 'acceptDiscoveredChannel') {
        setState((current) => ({
          ...current,
          existingIds: [...new Set([...current.existingIds, channel.id])],
          ignoredChannels: current.ignoredChannels.filter((item) => item.id !== channel.id),
        }));
      } else {
        setState((current) => ({
          ...current,
          channels: current.channels.filter((item) => item.id !== channel.id),
          ignoredChannels: [
            { ...channel, ignoredAt: new Date().toISOString() },
            ...current.ignoredChannels.filter((item) => item.id !== channel.id),
          ],
          existingIds: current.existingIds.filter((id) => id !== channel.id),
        }));
      }

      router.refresh();
      window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
    } catch {
      setState((current) => ({ ...current, error: 'Action failed.' }));
    } finally {
      setWorkingId(null);
    }
  }

  async function restoreIgnored(channelId: string) {
    setWorkingId(channelId);
    try {
      const response = await fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'restoreIgnoredChannel', channelId }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setState((current) => ({ ...current, error: data.error ?? 'Restore failed.' }));
        return;
      }
      setState((current) => ({
        ...current,
        ignoredChannels: current.ignoredChannels.filter((item) => item.id !== channelId),
      }));
      router.refresh();
      window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
    } catch {
      setState((current) => ({ ...current, error: 'Restore failed.' }));
    } finally {
      setWorkingId(null);
    }
  }

  async function fetchStats(channelId: string) {
    setStatsWorkingId(channelId);
    try {
      const response = await fetch(`/api/discover/channels/${encodeURIComponent(channelId)}/stats`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setState((current) => ({ ...current, error: data.error ?? 'Stats fetch failed.' }));
        return;
      }

      setState((current) => ({
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === channelId
            ? {
                ...channel,
                subscriberCount: data.subscriberCount,
                viewCount: data.viewCount,
                videoCount: data.videoCount,
                country: data.country,
              }
            : channel,
        ),
        quotaUnits: current.quotaUnits + (data.quotaUnits ?? 1),
      }));
    } catch {
      setState((current) => ({ ...current, error: 'Stats fetch failed.' }));
    } finally {
      setStatsWorkingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-5 space-y-4">
        <form
          className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search channels by keyword"
            className="w-full rounded-chonk border-2 border-duo-border bg-white px-4 py-3 text-sm font-extrabold text-duo-ink placeholder:text-duo-ink/40 focus:border-duo-green focus:outline-none"
          />
          <button className="btn-duo-green min-h-12" disabled={isPending}>
            {isPending ? 'Searching...' : 'Search'}
          </button>
        </form>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect label="Sort" value={order} onChange={setOrder}>
            <option value="relevance">Relevance</option>
            <option value="viewCount">Most viewed</option>
            <option value="videoCount">Most videos</option>
            <option value="date">Newest</option>
            <option value="rating">Rating</option>
            <option value="title">Title</option>
          </FilterSelect>
          <FilterSelect label="Region" value={regionCode} onChange={setRegionCode}>
            {REGION_OPTIONS.map((option) => (
              <option key={option.value || 'any'} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Language" value={relevanceLanguage} onChange={setRelevanceLanguage}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value || 'any'} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Safe search" value={safeSearch} onChange={setSafeSearch}>
            <option value="moderate">Moderate</option>
            <option value="strict">Strict</option>
            <option value="none">None</option>
          </FilterSelect>
          <FilterSelect label="Channel type" value={channelType} onChange={setChannelType}>
            <option value="any">Any channel</option>
            <option value="show">Shows only</option>
          </FilterSelect>
          <FilterSelect label="Topic" value={topicId} onChange={setTopicId}>
            {TOPIC_OPTIONS.map((option) => (
              <option key={option.value || 'any'} value={option.value}>
                {option.label}
              </option>
            ))}
          </FilterSelect>
          <DateInput label="Created after" value={publishedAfter} onChange={setPublishedAfter} />
          <DateInput label="Created before" value={publishedBefore} onChange={setPublishedBefore} />
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-extrabold text-duo-ink/60">
          <span className="chip cursor-default">Shows first 50 visible channels</span>
          <span className="chip cursor-default">{state.hiddenIgnored} ignored hidden</span>
          <span className="chip cursor-default">{state.quotaUnits} quota units</span>
        </div>
        {state.error && <p className="text-sm font-extrabold text-red-500">{state.error}</p>}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-extrabold text-duo-ink">Search results</h2>
            {state.nextPageToken && (
              <button className="btn-duo-blue px-3 py-2 text-xs" disabled={isPending} onClick={() => void runSearch(state.nextPageToken)}>
                Next 50
              </button>
            )}
          </div>

          {state.channels.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-lg font-extrabold text-duo-ink">Search a keyword to discover channels.</p>
              <p className="mt-2 text-sm font-bold text-duo-ink/50">Ignored channels stay hidden across future searches.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {state.channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  selected={currentIds.has(channel.id)}
                  working={workingId === channel.id}
                  statsWorking={statsWorkingId === channel.id}
                  onFetchStats={() => void fetchStats(channel.id)}
                  onAccept={() => void mutate('acceptDiscoveredChannel', channel)}
                  onIgnore={() => void mutate('ignoreDiscoveredChannel', channel)}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="card p-4 h-fit space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-extrabold text-duo-ink">Ignored channels</h2>
            <span className="chip cursor-default">{state.ignoredChannels.length}</span>
          </div>
          {state.ignoredChannels.length === 0 ? (
            <p className="rounded-chonk border-2 border-dashed border-duo-border bg-duo-soft/60 px-4 py-5 text-sm font-bold text-duo-mute">
              No ignored channels yet.
            </p>
          ) : (
            <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
              {state.ignoredChannels.map((channel) => (
                <div key={channel.id} className="rounded-2xl border-2 border-duo-border bg-duo-soft/50 p-3">
                  <div className="flex items-center gap-2">
                    {channel.thumbnail ? (
                      <img src={channel.thumbnail} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-white" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-duo-ink">{channel.title}</p>
                      <p className="truncate text-[11px] font-bold text-duo-ink/45">{channel.id}</p>
                    </div>
                  </div>
                  <button
                    className="btn-duo-ghost mt-3 w-full px-3 py-2 text-xs"
                    disabled={workingId === channel.id}
                    onClick={() => void restoreIgnored(channel.id)}
                  >
                    {workingId === channel.id ? '...' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-extrabold uppercase text-duo-ink/50">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border-2 border-duo-border bg-white px-3 py-2 text-sm font-bold text-duo-ink focus:border-duo-green focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-extrabold uppercase text-duo-ink/50">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border-2 border-duo-border bg-white px-3 py-2 text-sm font-bold text-duo-ink focus:border-duo-green focus:outline-none"
      />
    </label>
  );
}

function ChannelCard({
  channel,
  selected,
  working,
  statsWorking,
  onFetchStats,
  onAccept,
  onIgnore,
}: {
  channel: DiscoveredChannel;
  selected: boolean;
  working: boolean;
  statsWorking: boolean;
  onFetchStats: () => void;
  onAccept: () => void;
  onIgnore: () => void;
}) {
  const hasStats =
    typeof channel.subscriberCount === 'number' ||
    typeof channel.viewCount === 'number' ||
    typeof channel.videoCount === 'number';

  return (
    <article className="card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {channel.thumbnail ? (
          <img src={channel.thumbnail} alt="" className="h-16 w-16 rounded-2xl object-cover" />
        ) : (
          <div className="h-16 w-16 rounded-2xl bg-duo-soft" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-extrabold text-duo-ink">{channel.title}</h3>
            {selected && <span className="chip chip-active cursor-default text-xs">Selected</span>}
          </div>
          <p className="line-clamp-2 text-sm font-semibold text-duo-ink/60">{channel.description || channel.id}</p>
          <div className="flex flex-wrap gap-2 text-xs font-extrabold text-duo-ink/55">
            <span className="chip cursor-default">Subs {formatCount(channel.subscriberCount)}</span>
            <span className="chip cursor-default">Views {formatCount(channel.viewCount)}</span>
            <span className="chip cursor-default">Videos {formatCount(channel.videoCount)}</span>
            {channel.country && <span className="chip cursor-default">{channel.country}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <button className="btn-duo-blue flex-1 px-3 py-2 text-xs" disabled={statsWorking} onClick={onFetchStats}>
            {statsWorking ? '...' : hasStats ? 'Refresh stats' : 'Fetch stats'}
          </button>
          <button className="btn-duo-green flex-1 px-3 py-2 text-xs" disabled={working || selected} onClick={onAccept}>
            {selected ? 'Added' : working ? '...' : 'Select'}
          </button>
          <button className="btn-duo-ghost flex-1 px-3 py-2 text-xs text-red-500" disabled={working} onClick={onIgnore}>
            {working ? '...' : 'Ignore'}
          </button>
        </div>
      </div>
    </article>
  );
}
