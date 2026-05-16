import 'server-only';

import { getCookieChannelStore } from './channels-cookie';
import { normalizeQuotaUsage, getQuotaResetTimezone } from './drive';
import { getSession } from './session';
import { readUserSyncState, writeUserSyncState } from './sync-store';
import {
  DEFAULT_CHANNEL_SPACE,
  type ApiUsageKind,
  type ApiUsageOperation,
  type ApiUsageSummary,
  type ApiUsageTriggerCost,
  type ChannelPreferenceStore,
  type DailyQuotaUsage,
} from './types';
import { DEFAULT_VIEW_PREFERENCES } from './view-preferences';

export const YOUTUBE_DAILY_QUOTA_LIMIT = 10_000;
export const DEEPSEEK_DAILY_TOKEN_LIMIT = 1_000_000;

export const YOUTUBE_TRIGGER_COSTS: ApiUsageTriggerCost[] = [
  { label: 'Mixed feed load', cost: '1 channels.list + playlist/video detail calls for uncached channels' },
  { label: 'Channels page load', cost: '1 channels.list + playlist/video detail calls for uncached channels' },
  { label: 'Discover channel search', cost: '100 per uncached search.list page + 1 stats batch' },
  { label: 'Discover stats', cost: '1 channels.list call when uncached' },
  { label: 'Discover Top 3 videos', cost: '100 search.list + 1 videos.list when uncached' },
  { label: 'Short feed', cost: '100 search.list + 1 videos.list when uncached' },
  { label: 'Video comments panel', cost: '1 commentThreads.list when uncached' },
  { label: 'Saved video metadata refresh', cost: '1 videos.list per 50 uncached IDs' },
  { label: 'Add channel by handle', cost: '100 search.list when uncached' },
];

export const DEEPSEEK_TRIGGER_COSTS: ApiUsageTriggerCost[] = [
  { label: 'Video summary button', cost: 'DeepSeek total_tokens from summary request' },
  { label: 'Saved videos categorize', cost: 'DeepSeek total_tokens per categorization batch' },
  { label: 'Saved videos note search', cost: 'DeepSeek total_tokens per search' },
  { label: 'Vocab meaning fetch', cost: 'DeepSeek total_tokens per word' },
];

function emptyStore(): ChannelPreferenceStore {
  return {
    channels: [],
    spaces: [DEFAULT_CHANNEL_SPACE],
    view: DEFAULT_VIEW_PREFERENCES,
    viewUpdatedAt: new Date(0).toISOString(),
    updatesChannelIds: [],
    vocabs: [],
    ignoredChannels: [],
    discoverSearches: [],
  };
}

function usageForKind(state: { quota?: DailyQuotaUsage; deepseekQuota?: DailyQuotaUsage } | null, kind: ApiUsageKind) {
  return normalizeQuotaUsage(kind === 'youtube' ? state?.quota : state?.deepseekQuota);
}

function withNextUsage(usage: DailyQuotaUsage, label: string, units: number): DailyQuotaUsage {
  const now = new Date().toISOString();
  const normalizedUnits = Math.max(0, Math.ceil(units));
  const operation: ApiUsageOperation = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    units: normalizedUnits,
    at: now,
  };
  return {
    ...usage,
    used: usage.used + normalizedUnits,
    updatedAt: now,
    operations: [...(usage.operations ?? []), operation].slice(-200),
  };
}

export async function recordApiUsage(kind: ApiUsageKind, label: string, units: number): Promise<void> {
  const normalizedUnits = Math.max(0, Math.ceil(units));
  if (normalizedUnits <= 0) return;

  try {
    const session = await getSession();
    if (!session?.user) return;

    const [cookieStore, remote] = await Promise.all([
      getCookieChannelStore().catch(() => emptyStore()),
      readUserSyncState(session).catch(() => ({ state: null })),
    ]);
    const base = remote.state ?? cookieStore;
    const nextYoutube = kind === 'youtube' ? withNextUsage(usageForKind(remote.state, 'youtube'), label, normalizedUnits) : usageForKind(remote.state, 'youtube');
    const nextDeepSeek = kind === 'deepseek' ? withNextUsage(usageForKind(remote.state, 'deepseek'), label, normalizedUnits) : usageForKind(remote.state, 'deepseek');

    await writeUserSyncState(session, {
      channels: base.channels,
      spaces: base.spaces,
      view: base.view,
      viewUpdatedAt: base.viewUpdatedAt,
      updatesChannelIds: base.updatesChannelIds,
      vocabs: base.vocabs,
      ignoredChannels: base.ignoredChannels,
      discoverSearches: base.discoverSearches,
      activeDiscoverSearchId: base.activeDiscoverSearchId,
      discoverDraft: base.discoverDraft,
      lastPagePath: base.lastPagePath,
      quota: nextYoutube,
      deepseekQuota: nextDeepSeek,
    });
  } catch {
    // Usage tracking must not break the product flow that spent the quota.
  }
}

export async function readApiUsageSummaries(): Promise<{
  youtube: ApiUsageSummary;
  deepseek: ApiUsageSummary;
  resetTimezone: string;
}> {
  const session = await getSession();
  const remote = session?.user ? await readUserSyncState(session).catch(() => ({ state: null })) : { state: null };
  const youtube = usageForKind(remote.state, 'youtube');
  const deepseek = usageForKind(remote.state, 'deepseek');

  return {
    resetTimezone: getQuotaResetTimezone(),
    youtube: buildSummary('youtube', 'YouTube Data API', YOUTUBE_DAILY_QUOTA_LIMIT, youtube, YOUTUBE_TRIGGER_COSTS),
    deepseek: buildSummary('deepseek', 'DeepSeek tokens', DEEPSEEK_DAILY_TOKEN_LIMIT, deepseek, DEEPSEEK_TRIGGER_COSTS),
  };
}

export function buildSummary(
  kind: ApiUsageKind,
  label: string,
  dailyLimit: number,
  usage: DailyQuotaUsage,
  triggerCosts: ApiUsageTriggerCost[],
): ApiUsageSummary {
  const usedToday = Math.max(0, Math.floor(usage.used || 0));
  return {
    kind,
    label,
    dailyLimit,
    usedToday,
    remainingToday: Math.max(0, dailyLimit - usedToday),
    usedTodayPercent: dailyLimit > 0 ? (usedToday / dailyLimit) * 100 : 0,
    updatedAt: usage.updatedAt,
    operations: usage.operations ?? [],
    triggerCosts,
  };
}
