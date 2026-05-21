import { revalidatePath } from 'next/cache';
import {
  parseTelegramTubeoIntent,
  type TelegramTubeoIntentAction,
} from '@/lib/deepseek';
import { DEFAULT_VIEW_PREFERENCES } from '@/lib/view-preferences';
import {
  parseYouTubeVideoId,
  resolveSavedVideoFromUrl,
  type SavedVideo,
} from '@/lib/saved-videos';
import {
  isSupabaseSavedVideosConfigured,
  readSupabaseSavedVideos,
  writeSupabaseSavedVideos,
} from '@/lib/supabase-saved-videos';
import {
  isSupabaseSyncConfigured,
  readSupabaseSyncState,
  writeSupabaseSyncState,
  type TubeoUserIdentity,
} from '@/lib/supabase-sync';
import { clearMemoryYtCacheForDate, getCachedYouTubeJson } from '@/lib/youtube-api-cache';
import { clearYtCacheForDate, isSupabaseYtCacheConfigured } from '@/lib/supabase-yt-cache';
import { istDateString } from '@/lib/news-source';
import { normalizeSpaceName } from '@/lib/spaces';
import {
  DEFAULT_CHANNEL_SPACE,
  type ChannelPreferenceStore,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

interface IngestBody {
  text?: string;
  replyText?: string;
  lastUrl?: string;
  telegramUserId?: number | string;
  telegramMessageId?: number | string;
}

interface ActionResult {
  type: TelegramTubeoIntentAction['type'];
  ok: boolean;
  message: string;
  url?: string;
  id?: string;
  alreadyExisted?: boolean;
}

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function authOk(req: Request): boolean {
  const secret = process.env.TUBEO_TELEGRAM_INGEST_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

function getOwnerIdentity(): TubeoUserIdentity {
  const email = process.env.TUBEO_TELEGRAM_OWNER_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('TUBEO_TELEGRAM_OWNER_EMAIL is not configured.');
  return {
    ownerKey: `google:${email}`,
    email,
    name: process.env.TUBEO_TELEGRAM_OWNER_NAME?.trim() || null,
  };
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match?.[0]?.replace(/[),.;!?]+$/g, '') ?? null;
}

function isYouTubeUrl(raw: string): boolean {
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname.includes('youtu');
  } catch {
    return false;
  }
}

function parseChannelInput(raw: string): { type: 'id'; value: string } | { type: 'handle'; value: string } | null {
  const s = raw.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { type: 'id', value: s };

  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    if (!url.hostname.includes('youtu')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && parts[1]?.startsWith('UC')) return { type: 'id', value: parts[1] };
    const handle = parts[0]?.startsWith('@') ? parts[0] : parts[1]?.startsWith('@') ? parts[1] : '';
    if (handle) return { type: 'handle', value: handle.replace(/^@/, '') };
  } catch {
    if (s) return { type: 'handle', value: s.replace(/^@/, '') };
  }

  return null;
}

async function resolveYouTubeChannel(raw: string): Promise<{ id: string; title?: string }> {
  if (!isYouTubeUrl(raw) && !/^UC[\w-]{22}$/.test(raw.trim())) {
    throw new Error('Channel add needs a YouTube URL, handle, or channel ID.');
  }

  const videoId = parseYouTubeVideoId(raw);
  if (videoId) {
    const result = await getCachedYouTubeJson<{
      items?: Array<{ snippet?: { channelId?: string; channelTitle?: string } }>;
    }>('videos', {
      part: 'snippet',
      id: videoId,
      maxResults: '1',
    });
    const snippet = result.data.items?.[0]?.snippet;
    const id = snippet?.channelId?.trim();
    if (!id) throw new Error('Could not resolve channel from YouTube video.');
    return { id, title: snippet?.channelTitle };
  }

  const parsed = parseChannelInput(raw);
  if (!parsed) throw new Error('Could not parse YouTube channel URL or handle.');
  if (parsed.type === 'id') return { id: parsed.value };

  const result = await getCachedYouTubeJson<{
    items?: Array<{ snippet?: { channelId?: string; title?: string } }>;
  }>('search', {
    part: 'snippet',
    type: 'channel',
    q: parsed.value,
    maxResults: '1',
  });
  const snippet = result.data.items?.[0]?.snippet;
  const id = snippet?.channelId?.trim();
  if (!id) throw new Error(`Channel not found for "${parsed.value}".`);
  return { id, title: snippet?.title };
}

function emptyChannelStore(): ChannelPreferenceStore {
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

async function bustTubeoCaches(): Promise<void> {
  const today = istDateString();
  if (isSupabaseYtCacheConfigured()) {
    await clearYtCacheForDate(today).catch(() => undefined);
  }
  clearMemoryYtCacheForDate(today);
  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
  revalidatePath('/updates');
  revalidatePath('/videos');
}

async function readSavedVideos(identity: TubeoUserIdentity): Promise<SavedVideo[]> {
  if (!isSupabaseSavedVideosConfigured()) {
    throw new Error('Tubeo Supabase saved-videos sync is not configured.');
  }
  return (await readSupabaseSavedVideos(identity))?.videos ?? [];
}

async function saveWatchLater(
  identity: TubeoUserIdentity,
  url: string,
  note = '',
): Promise<ActionResult> {
  const resolved = resolveSavedVideoFromUrl(url);
  if (!resolved) throw new Error('Enter a valid YouTube, Instagram, or webpage URL.');

  const current = await readSavedVideos(identity);
  const existing = current.find((video) => video.id === resolved.id);
  const cleanNote = note.trim();
  const savedVideo: SavedVideo = existing
    ? {
        ...existing,
        url: resolved.url,
        ...(cleanNote ? { note: cleanNote } : {}),
      }
    : {
        id: resolved.id,
        url: resolved.url,
        note: cleanNote,
        category: 'Uncategorized',
        addedAt: new Date().toISOString(),
      };
  const next = [savedVideo, ...current.filter((video) => video.id !== resolved.id)];
  await writeSupabaseSavedVideos(identity, next);
  revalidatePath('/videos');
  return {
    type: 'save_watch_later',
    ok: true,
    message: existing ? 'watch later already existed' : 'saved watch later',
    url: resolved.url,
    id: resolved.id,
    alreadyExisted: Boolean(existing),
  };
}

async function updateWatchLaterNote(
  identity: TubeoUserIdentity,
  url: string,
  note: string,
  mode: 'replace' | 'append' = 'replace',
): Promise<ActionResult> {
  const resolved = resolveSavedVideoFromUrl(url);
  if (!resolved) throw new Error('Enter a valid YouTube, Instagram, or webpage URL.');

  const current = await readSavedVideos(identity);
  const existing = current.find((video) => video.id === resolved.id);
  const cleanNote = note.trim();
  const savedVideo: SavedVideo = existing
    ? {
        ...existing,
        url: resolved.url,
        note: mode === 'append' && existing.note ? `${existing.note}\n${cleanNote}` : cleanNote,
      }
    : {
        id: resolved.id,
        url: resolved.url,
        note: cleanNote,
        category: 'Uncategorized',
        addedAt: new Date().toISOString(),
      };
  const next = [savedVideo, ...current.filter((video) => video.id !== resolved.id)];
  await writeSupabaseSavedVideos(identity, next);
  revalidatePath('/videos');
  return {
    type: 'update_watch_later_note',
    ok: true,
    message: existing ? 'updated note' : 'saved watch later with note',
    url: resolved.url,
    id: resolved.id,
    alreadyExisted: Boolean(existing),
  };
}

async function addYouTubeChannel(
  identity: TubeoUserIdentity,
  url: string,
): Promise<ActionResult> {
  if (!isSupabaseSyncConfigured()) {
    throw new Error('Tubeo Supabase sync is not configured.');
  }

  const channel = await resolveYouTubeChannel(url);
  const remote = await readSupabaseSyncState(identity);
  const base = remote ?? {
    ...emptyChannelStore(),
    quota: undefined,
    deepseekQuota: undefined,
    quotaHistory: undefined,
    deepseekQuotaHistory: undefined,
    updatedAt: new Date(0).toISOString(),
  };
  const targetSpace = normalizeSpaceName(DEFAULT_CHANNEL_SPACE);
  const exists = base.channels.some((item) => item.id === channel.id);
  if (!exists) {
    await writeSupabaseSyncState(identity, {
      channels: [...base.channels, { id: channel.id, space: targetSpace }],
      spaces: base.spaces.includes(targetSpace) ? base.spaces : [...base.spaces, targetSpace],
      view: base.view,
      viewUpdatedAt: base.viewUpdatedAt,
      updatesChannelIds: base.updatesChannelIds,
      vocabs: base.vocabs,
      ignoredChannels: base.ignoredChannels,
      discoverSearches: base.discoverSearches,
      activeDiscoverSearchId: base.activeDiscoverSearchId,
      discoverDraft: base.discoverDraft,
      lastPagePath: base.lastPagePath,
      quota: base.quota,
      deepseekQuota: base.deepseekQuota,
      quotaHistory: base.quotaHistory,
      deepseekQuotaHistory: base.deepseekQuotaHistory,
    });
    await bustTubeoCaches();
  }

  return {
    type: 'add_youtube_channel',
    ok: true,
    message: exists ? 'channel already added' : 'added channel',
    url,
    id: channel.id,
    alreadyExisted: exists,
  };
}

async function runAction(identity: TubeoUserIdentity, action: TelegramTubeoIntentAction): Promise<ActionResult> {
  switch (action.type) {
    case 'save_watch_later':
      return saveWatchLater(identity, action.url, action.note);
    case 'update_watch_later_note':
      return updateWatchLaterNote(identity, action.url, action.note, action.mode);
    case 'add_youtube_channel':
      return addYouTubeChannel(identity, action.url);
    case 'none':
      return {
        type: 'none',
        ok: true,
        message: action.reason || 'no Tubeo action',
      };
  }
}

export async function POST(req: Request) {
  if (!authOk(req)) return fail('Unauthorized', 401);

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return fail('Invalid request body');
  }

  const text = String(body.text ?? '').trim();
  const replyText = String(body.replyText ?? '').trim();
  const lastUrl = String(body.lastUrl ?? '').trim();
  if (!text && !replyText && !lastUrl) return fail('Nothing to process.');

  let identity: TubeoUserIdentity;
  try {
    identity = getOwnerIdentity();
  } catch (error) {
    return fail((error as Error).message, 500);
  }

  let intent;
  try {
    intent = await parseTelegramTubeoIntent({ text, replyText, lastUrl });
  } catch (error) {
    return fail((error as Error).message || 'DeepSeek intent parsing failed.', 502);
  }

  const results: ActionResult[] = [];
  for (const action of intent.actions) {
    try {
      results.push(await runAction(identity, action));
    } catch (error) {
      results.push({
        type: action.type,
        ok: false,
        message: (error as Error).message || 'Action failed.',
        url: 'url' in action ? action.url : undefined,
      });
    }
  }

  const firstUrl = extractUrl(text) ?? extractUrl(replyText) ?? (lastUrl || null);
  return Response.json({
    ok: results.every((result) => result.ok),
    summary: results.map((result) => result.message).join(' + ') || intent.summary,
    firstUrl,
    intent,
    results,
  });
}
