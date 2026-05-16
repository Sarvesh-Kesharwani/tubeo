'use server';

import { revalidatePath } from 'next/cache';
import {
  getCookieChannelIds,
  getCookieChannelSyncMeta,
  getCookieChannelStore,
  getCookieChannelPreferences,
  hasDriveSyncHydrated,
  markCookieChannelStoreDirty,
  markCookieChannelStoreSynced,
  markDriveSyncHydrated,
  setCookieChannelStore,
  setCookieChannelSpaces,
  setCookieChannelPreferences,
} from '@/lib/channels-cookie';
import { getSession } from '@/lib/session';
import { recordApiUsage } from '@/lib/api-usage';
import { normalizeSpaceName } from '@/lib/spaces';
import { readUserSyncState } from '@/lib/sync-store';
import { DEFAULT_CHANNEL_SPACE } from '@/lib/types';
import { getEnvChannelIds } from '@/lib/whitelist';
import { getCachedYouTubeJson } from '@/lib/youtube-api-cache';

async function hydrateCookieStoreFromDriveIfNeeded(): Promise<void> {
  const session = await getSession();
  if (!session?.user) return;
  if (await hasDriveSyncHydrated()) return;

  const remote = await readUserSyncState(session);
  const driveData = remote.state;
  const localMeta = await getCookieChannelSyncMeta();
  if (driveData) {
    const envIds = getEnvChannelIds();
    await setCookieChannelStore({
      channels: driveData.channels.filter((channel) => !envIds.includes(channel.id)),
      spaces: driveData.spaces,
      view: driveData.view,
      viewUpdatedAt: driveData.viewUpdatedAt,
      updatesChannelIds: driveData.updatesChannelIds,
      vocabs: driveData.vocabs,
      ignoredChannels: driveData.ignoredChannels,
      discoverSearches: driveData.discoverSearches,
      activeDiscoverSearchId: driveData.activeDiscoverSearchId,
    });
    await markCookieChannelStoreSynced(driveData.updatedAt);
  } else if (localMeta.updatedAt) {
    await markCookieChannelStoreSynced(localMeta.updatedAt);
  }

  await markDriveSyncHydrated();
}

// Extract a handle or channel ID from any YouTube channel URL.
function parseInput(raw: string): { type: 'id'; value: string } | { type: 'handle'; value: string } | null {
  const s = raw.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { type: 'id', value: s };

  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && parts[1]?.startsWith('UC')) return { type: 'id', value: parts[1] };
    const handle = parts[0]?.startsWith('@') ? parts[0] : parts[1]?.startsWith('@') ? parts[1] : parts[0];
    if (handle) return { type: 'handle', value: handle.replace(/^@/, '') };
  } catch {
    if (s) return { type: 'handle', value: s.replace(/^@/, '') };
  }
  return null;
}

async function resolveToChannelId(raw: string): Promise<string> {
  const parsed = parseInput(raw);
  if (!parsed) throw new Error('Could not parse channel URL or handle');

  if (parsed.type === 'id') return parsed.value;

  const result = await getCachedYouTubeJson<{
    items?: Array<{ snippet?: { channelId?: string } }>;
  }>('search', {
    part: 'snippet',
    type: 'channel',
    q: parsed.value,
    maxResults: '1',
  });
  const data = result.data;
  const id = data.items?.[0]?.snippet?.channelId;
  if (!id) throw new Error(`Channel not found for "${parsed.value}"`);
  await recordApiUsage('youtube', `Add channel by handle: ${parsed.value}`, result.fromCache ? 0 : 100);
  return id;
}

export async function addChannelAction(
  _prev: { error?: string; success?: string },
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  await hydrateCookieStoreFromDriveIfNeeded();

  const input = (formData.get('url') as string ?? '').trim();
  if (!input) return { error: 'Please enter a channel URL or handle.' };

  let channelId: string;
  try {
    channelId = await resolveToChannelId(input);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const existing = await getCookieChannelIds();
  if (existing.includes(channelId)) return { error: 'Channel already added.' };

  const channels = await getCookieChannelPreferences();
  await setCookieChannelPreferences([...channels, { id: channelId, space: DEFAULT_CHANNEL_SPACE }]);
  await markCookieChannelStoreDirty();
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
  return { success: channelId };
}

export async function removeChannelAction(channelId: string): Promise<void> {
  await hydrateCookieStoreFromDriveIfNeeded();
  const existing = await getCookieChannelPreferences();
  await setCookieChannelPreferences(existing.filter((channel) => channel.id !== channelId));
  await markCookieChannelStoreDirty();
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
}

export async function updateChannelSpaceAction(channelId: string, nextSpace: string): Promise<void> {
  await hydrateCookieStoreFromDriveIfNeeded();
  const store = await getCookieChannelStore();
  const existing = store.channels;
  const normalizedSpace = normalizeSpaceName(nextSpace);
  const index = existing.findIndex((channel) => channel.id === channelId);

  if (index === -1) {
    await setCookieChannelPreferences([...existing, { id: channelId, space: normalizedSpace }]);
  } else {
    const updated = [...existing];
    updated[index] = { ...updated[index], space: normalizedSpace };
    await setCookieChannelPreferences(updated);
  }
  await setCookieChannelSpaces([...store.spaces, normalizedSpace]);
  await markCookieChannelStoreDirty();

  revalidatePath('/channels');
  revalidatePath('/settings');
}

export async function createChannelSpaceAction(
  _prev: { error?: string; success?: string },
  formData: FormData,
): Promise<{ error?: string; success?: string }> {
  await hydrateCookieStoreFromDriveIfNeeded();
  const nextSpace = normalizeSpaceName((formData.get('space') as string | null) ?? '');
  const store = await getCookieChannelStore();

  if (store.spaces.includes(nextSpace)) {
    return { error: 'That space already exists.' };
  }

  await setCookieChannelSpaces([...store.spaces, nextSpace]);
  await markCookieChannelStoreDirty();
  revalidatePath('/channels');
  revalidatePath('/settings');
  return { success: nextSpace };
}

export async function renameChannelSpaceAction(
  currentSpace: string,
  nextSpace: string,
): Promise<{ error?: string; success?: string }> {
  await hydrateCookieStoreFromDriveIfNeeded();
  const existingSpace = normalizeSpaceName(currentSpace);
  const renamedSpace = normalizeSpaceName(nextSpace);
  const store = await getCookieChannelStore();

  if (existingSpace === DEFAULT_CHANNEL_SPACE) {
    return { error: `${DEFAULT_CHANNEL_SPACE} is the default space and cannot be renamed.` };
  }

  if (!store.spaces.includes(existingSpace)) {
    return { error: 'That space no longer exists.' };
  }

  if (existingSpace !== renamedSpace && store.spaces.includes(renamedSpace)) {
    return { error: 'That space already exists.' };
  }

  if (existingSpace === renamedSpace) {
    return { success: renamedSpace };
  }

  await setCookieChannelStore({
    channels: store.channels.map((channel) =>
      channel.space === existingSpace ? { ...channel, space: renamedSpace } : channel,
    ),
    spaces: store.spaces.map((space) => (space === existingSpace ? renamedSpace : space)),
    view: store.view,
    viewUpdatedAt: store.viewUpdatedAt,
    updatesChannelIds: store.updatesChannelIds,
    vocabs: store.vocabs,
    ignoredChannels: store.ignoredChannels,
    discoverSearches: store.discoverSearches,
    activeDiscoverSearchId: store.activeDiscoverSearchId,
  });
  await markCookieChannelStoreDirty();

  revalidatePath('/channels');
  revalidatePath('/settings');
  return { success: renamedSpace };
}

export async function deleteChannelSpaceAction(spaceToDelete: string): Promise<{ error?: string; success?: string }> {
  await hydrateCookieStoreFromDriveIfNeeded();
  const targetSpace = normalizeSpaceName(spaceToDelete);
  const store = await getCookieChannelStore();

  if (targetSpace === DEFAULT_CHANNEL_SPACE) {
    return { error: `${DEFAULT_CHANNEL_SPACE} is the default space and cannot be deleted.` };
  }

  if (!store.spaces.includes(targetSpace)) {
    return { error: 'That space no longer exists.' };
  }

  await setCookieChannelStore({
    channels: store.channels.map((channel) =>
      channel.space === targetSpace ? { ...channel, space: DEFAULT_CHANNEL_SPACE } : channel,
    ),
    spaces: store.spaces.filter((space) => space !== targetSpace),
    view: store.view,
    viewUpdatedAt: store.viewUpdatedAt,
    updatesChannelIds: store.updatesChannelIds,
    vocabs: store.vocabs,
    ignoredChannels: store.ignoredChannels,
    discoverSearches: store.discoverSearches,
    activeDiscoverSearchId: store.activeDiscoverSearchId,
  });
  await markCookieChannelStoreDirty();

  revalidatePath('/channels');
  revalidatePath('/settings');
  return { success: targetSpace };
}
