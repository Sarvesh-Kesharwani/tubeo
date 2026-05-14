import 'server-only';

import { resolveSavedVideoFromUrl, type SavedVideo } from './saved-videos';

const DEFAULT_SYNC_TABLE = 'tubeo_user_sync_state';
const INBOX_OWNER_KEY = 'instagram:toolshub2026:reel-inbox';
const INBOX_EMAIL = 'toolshub2026@instagram.local';
const LINKNEST_SENDER_ID = 'instagram:toolshub2026';
const LINKNEST_SENDER_USERNAME = 'toolshub2026';
const DEFAULT_LINKNEST_TABLE = 'saved_links';
const INBOX_CATEGORY = 'Instagram Inbox';
const MAX_INBOX_REELS = 200;
const DEFAULT_GRAPH_VERSION = 'v21.0';

export const DEFAULT_INSTAGRAM_CHANNEL = {
  username: 'deadliestfiles',
  title: 'deadliestfiles',
  url: 'https://www.instagram.com/deadliestfiles/reels/',
};

export const INSTAGRAM_CHANNEL_PREFIX = 'ig:';

export interface InstagramReel {
  id: string;
  shortcode: string;
  url: string;
  title: string;
  thumbnail: string;
  publishedAt: string;
  channelUsername: string;
}

export function isInstagramChannelId(id: string): boolean {
  return id.startsWith(INSTAGRAM_CHANNEL_PREFIX) && id.length > INSTAGRAM_CHANNEL_PREFIX.length;
}

export function instagramChannelId(username: string): string {
  return `${INSTAGRAM_CHANNEL_PREFIX}${username.trim().replace(/^@/, '').toLowerCase()}`;
}

export function instagramUsernameFromChannelId(id: string): string {
  return isInstagramChannelId(id) ? id.slice(INSTAGRAM_CHANNEL_PREFIX.length) : id;
}

export function parseInstagramChannelInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    if (!url.hostname.includes('instagram.com')) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const username = segments[0]?.replace(/^@/, '').toLowerCase();
    if (!username || ['reel', 'reels', 'p', 'tv', 'explore'].includes(username)) return null;
    return /^[a-z0-9._]+$/i.test(username) ? username : null;
  } catch {
    return null;
  }
}

interface SupabaseConfig {
  url: string;
  key: string;
  table: string;
}

interface SupabaseInboxRow {
  owner_key: string;
  user_email: string;
  user_name: string | null;
  state: {
    instagramReelInbox?: SavedVideo[];
    updatedAt?: string;
  };
  state_updated_at: string;
}

interface LinkNestRow {
  id: string;
  canonical_url: string | null;
  original_url: string | null;
  note: string | null;
  created_at: string | null;
}

interface InstagramMediaNode {
  id?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

interface BusinessDiscoveryResponse {
  business_discovery?: {
    username?: string;
    name?: string;
    profile_picture_url?: string;
    media?: {
      data?: InstagramMediaNode[];
    };
  };
  error?: {
    message?: string;
  };
}

interface InstagramWebhookEntry {
  messaging?: Array<{
    sender?: {
      id?: string;
    };
    message?: unknown;
  }>;
}

interface InstagramWebhookPayload {
  entry?: InstagramWebhookEntry[];
}

function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.TUBEO_SUPABASE_URL?.trim();
  const key =
    process.env.TUBEO_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_SECRET_KEY?.trim();
  const table = process.env.TUBEO_SUPABASE_SYNC_TABLE?.trim() || DEFAULT_SYNC_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, table };
}

function linkNestConfig(): SupabaseConfig | null {
  const url = process.env.LINKNEST_SUPABASE_URL?.trim();
  const key = process.env.LINKNEST_SUPABASE_KEY?.trim();
  const table = process.env.LINKNEST_SUPABASE_TABLE?.trim() || DEFAULT_LINKNEST_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, table };
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function tableUrl(config: SupabaseConfig): string {
  return `${config.url}/rest/v1/${encodeURIComponent(config.table)}`;
}

function uniqueSavedVideos(videos: SavedVideo[]): SavedVideo[] {
  const seen = new Set<string>();
  const out: SavedVideo[] = [];

  for (const video of videos) {
    if (!video.id || !video.url || seen.has(video.id)) continue;
    seen.add(video.id);
    out.push({
      id: video.id,
      url: video.url,
      note: video.note ?? '',
      category: video.category || INBOX_CATEGORY,
      addedAt: video.addedAt || new Date().toISOString(),
    });
  }

  return out;
}

export async function readInstagramInboxSavedVideos(): Promise<SavedVideo[]> {
  const linkNest = await readInstagramInboxFromLinkNest();
  if (linkNest.length > 0) return linkNest;

  const cfg = supabaseConfig();
  if (!cfg) return [];

  const qs = new URLSearchParams({
    owner_key: `eq.${INBOX_OWNER_KEY}`,
    select: 'state',
    limit: '1',
  });
  const res = await fetch(`${tableUrl(cfg)}?${qs}`, {
    headers: headers(cfg.key),
    cache: 'no-store',
  });

  if (!res.ok) return [];

  const rows = (await res.json().catch(() => [])) as Array<{
    state?: { instagramReelInbox?: SavedVideo[] };
  }>;
  return uniqueSavedVideos(rows[0]?.state?.instagramReelInbox ?? []);
}

async function readInstagramInboxFromLinkNest(): Promise<SavedVideo[]> {
  const cfg = linkNestConfig();
  if (!cfg) return [];

  const qs = new URLSearchParams({
    sender_id: `eq.${LINKNEST_SENDER_ID}`,
    platform: 'eq.instagram',
    note_status: 'in.(added,pending)',
    select: 'id,canonical_url,original_url,note,created_at',
    order: 'created_at.desc',
    limit: String(MAX_INBOX_REELS),
  });
  const res = await fetch(`${tableUrl(cfg)}?${qs}`, {
    headers: headers(cfg.key),
    cache: 'no-store',
  });

  if (!res.ok) return [];

  const rows = (await res.json().catch(() => [])) as LinkNestRow[];
  const videos: SavedVideo[] = [];
  for (const row of rows) {
    const resolved = resolveSavedVideoFromUrl(row.canonical_url || row.original_url || '');
    if (!resolved) continue;
    videos.push({
      id: resolved.id,
      url: resolved.url,
      note: row.note?.trim() || 'Forwarded to @toolshub2026',
      category: INBOX_CATEGORY,
      addedAt: row.created_at || new Date().toISOString(),
      source: 'linknest',
      linkNestId: row.id,
    });
  }

  return uniqueSavedVideos(videos);
}

async function writeInstagramInboxSavedVideos(videos: SavedVideo[]): Promise<boolean> {
  const cfg = supabaseConfig();
  if (!cfg) return false;

  const updatedAt = new Date().toISOString();
  const row: SupabaseInboxRow = {
    owner_key: INBOX_OWNER_KEY,
    user_email: INBOX_EMAIL,
    user_name: 'Toolshub Instagram Inbox',
    state: {
      instagramReelInbox: uniqueSavedVideos(videos).slice(0, MAX_INBOX_REELS),
      updatedAt,
    },
    state_updated_at: updatedAt,
  };
  const qs = new URLSearchParams({ on_conflict: 'owner_key' });
  const res = await fetch(`${tableUrl(cfg)}?${qs}`, {
    method: 'POST',
    headers: {
      ...headers(cfg.key),
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  });
  return res.ok;
}

async function appendInstagramInboxToLinkNest(videos: SavedVideo[]): Promise<{ persisted: boolean; inserted: number }> {
  const cfg = linkNestConfig();
  if (!cfg) return { persisted: false, inserted: 0 };

  const rows = videos.map((video) => ({
    sender_id: LINKNEST_SENDER_ID,
    sender_username: LINKNEST_SENDER_USERNAME,
    chat_id: LINKNEST_SENDER_ID,
    platform: 'instagram',
    original_url: video.url,
    canonical_url: video.url,
    note: video.note || 'Forwarded to @toolshub2026',
    note_status: 'added',
    metadata: {
      source: 'instagram_webhook',
      saved_video_id: video.id,
    },
  }));
  if (rows.length === 0) return { persisted: true, inserted: 0 };

  const res = await fetch(`${tableUrl(cfg)}`, {
    method: 'POST',
    headers: {
      ...headers(cfg.key),
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
    cache: 'no-store',
  });

  if (!res.ok) return { persisted: false, inserted: 0 };
  const insertedRows = (await res.json().catch(() => [])) as unknown[];
  return { persisted: true, inserted: Array.isArray(insertedRows) ? insertedRows.length : rows.length };
}

export function extractInstagramReelUrlsFromPayload(payload: unknown): string[] {
  const urls = new Set<string>();
  const seenObjects = new WeakSet<object>();
  const reelUrlPattern = /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[\w-]+\/?(?:\?[^\s"'<>)]*)?/gi;

  function scan(value: unknown): void {
    if (typeof value === 'string') {
      for (const match of value.matchAll(reelUrlPattern)) urls.add(match[0].replace(/&amp;/g, '&'));
      return;
    }

    if (!value || typeof value !== 'object') return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }

    Object.values(value as Record<string, unknown>).forEach(scan);
  }

  scan(payload);
  return [...urls];
}

export function extractInstagramSenderIdsFromPayload(payload: unknown): string[] {
  const ids = new Set<string>();
  const entries = (payload as InstagramWebhookPayload | null)?.entry;
  if (!Array.isArray(entries)) return [];

  for (const entry of entries) {
    if (!Array.isArray(entry?.messaging)) continue;
    for (const event of entry.messaging) {
      if (!event?.message) continue;
      const id = event?.sender?.id?.trim();
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

export async function appendInstagramInboxReels(
  urls: string[],
): Promise<{ added: number; total: number; persisted: boolean }> {
  const incoming = urls
    .map((url) => resolveSavedVideoFromUrl(url))
    .filter((item): item is { id: string; url: string } => Boolean(item))
    .map((item) => ({
      id: item.id,
      url: item.url,
      note: 'Forwarded to @toolshub2026',
      category: INBOX_CATEGORY,
      addedAt: new Date().toISOString(),
    } satisfies SavedVideo));

  if (incoming.length === 0) {
    return { added: 0, total: (await readInstagramInboxSavedVideos()).length, persisted: true };
  }

  const existing = await readInstagramInboxSavedVideos();
  const before = new Set(existing.map((video) => video.id));
  const newIncoming = incoming.filter((video) => !before.has(video.id));
  const linkNestResult = await appendInstagramInboxToLinkNest(newIncoming);
  const merged = uniqueSavedVideos([...newIncoming, ...existing]).slice(0, MAX_INBOX_REELS);
  const fallbackPersisted = linkNestResult.persisted ? true : await writeInstagramInboxSavedVideos(merged);
  const persisted = linkNestResult.persisted || fallbackPersisted;

  return {
    added: persisted ? newIncoming.length : 0,
    total: persisted ? merged.length : existing.length,
    persisted,
  };
}

function graphConfig(): { token: string; userId: string; version: string } | null {
  const token =
    process.env.INSTAGRAM_ACCESS_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim();
  const userId =
    process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID?.trim() ||
    process.env.INSTAGRAM_USER_ID?.trim();
  const version = process.env.INSTAGRAM_API_VERSION?.trim() || DEFAULT_GRAPH_VERSION;

  if (!token || !userId) return null;
  return { token, userId, version };
}

export async function sendInstagramMessage(recipientId: string, text: string): Promise<boolean> {
  const cfg = graphConfig();
  const cleanRecipientId = recipientId.trim();
  const cleanText = text.trim();

  if (!cfg || !cleanRecipientId || !cleanText) return false;

  const payload = {
    recipient: { id: cleanRecipientId },
    message: { text: cleanText.slice(0, 1000) },
  };
  const hosts = [
    process.env.INSTAGRAM_MESSAGING_GRAPH_HOST?.trim() || 'graph.instagram.com',
    'graph.facebook.com',
  ].filter((host, index, all) => host && all.indexOf(host) === index);

  for (const host of hosts) {
    const res = await fetch(`https://${host}/${cfg.version}/${cfg.userId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (res.ok) return true;

    const body = await res.text().catch(() => '');
    console.warn('instagram_message_reply_failed', {
      host,
      status: res.status,
      body: body.slice(0, 500),
    });
  }

  return false;
}

function titleFromCaption(caption: string | undefined, fallback: string): string {
  const clean = (caption ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
}

function shortcodeFromPermalink(permalink: string | undefined, fallback: string): string {
  if (!permalink) return fallback;
  try {
    const segments = new URL(permalink).pathname.split('/').filter(Boolean);
    return segments[1] ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getInstagramChannelReels(username: string, limit = 5): Promise<{
  reels: InstagramReel[];
  error?: string;
}> {
  const cleanUsername = username.trim().replace(/^@/, '').toLowerCase();
  const cfg = graphConfig();
  if (!cfg) {
    return {
      reels: [],
      error: 'Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID to load Instagram reels.',
    };
  }

  const fields = `business_discovery.username(${cleanUsername}){id,username,name,profile_picture_url,media.limit(12){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp}}`;
  const qs = new URLSearchParams({
    fields,
    access_token: cfg.token,
  });
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${cfg.userId}?${qs}`, {
    next: { revalidate: 600 },
  });

  const data = (await res.json().catch(() => null)) as BusinessDiscoveryResponse | null;
  if (!res.ok || data?.error) {
    return {
      reels: [],
      error: data?.error?.message ?? `Instagram Graph API failed: ${res.status}`,
    };
  }

  const channel = data?.business_discovery;
  const media = channel?.media?.data ?? [];
  const reels = media
      .filter((item) => item.permalink && (item.permalink.includes('/reel/') || item.media_type === 'VIDEO'))
    .slice(0, Math.max(1, limit))
    .map((item) => {
      const permalink = item.permalink ?? DEFAULT_INSTAGRAM_CHANNEL.url;
      const shortcode = shortcodeFromPermalink(permalink, item.id ?? permalink);
      return {
        id: `ig_${shortcode}`,
        shortcode,
        url: permalink,
        title: titleFromCaption(item.caption, `Instagram reel ${shortcode}`),
        thumbnail: item.thumbnail_url ?? item.media_url ?? channel?.profile_picture_url ?? '',
        publishedAt: item.timestamp ?? new Date(0).toISOString(),
        channelUsername: channel?.username ?? cleanUsername,
      } satisfies InstagramReel;
    });

  return { reels };
}

export async function getDefaultInstagramChannelReels(limit = 5): Promise<{
  reels: InstagramReel[];
  error?: string;
}> {
  return getInstagramChannelReels(DEFAULT_INSTAGRAM_CHANNEL.username, limit);
}
