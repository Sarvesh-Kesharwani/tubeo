import 'server-only';

import { createHash } from 'crypto';
import type { NewsYouLearnVideo, YouLearnTranscriptSegment } from './types';

interface YouLearnContent {
  type?: string;
  title?: string;
  content_url?: string;
  thumbnail_url?: string;
  content_id?: string;
  _id?: string;
  length?: number;
  duration?: number;
  contents?: YouLearnContent[];
  children?: YouLearnContent[];
  items?: YouLearnContent[];
}

interface YouLearnTranscriptChunk {
  page_content?: string;
  source?: number;
  idx?: number;
}

interface YouLearnSource {
  id: string;
  kind: 'space' | 'folder' | 'playlist';
}

function collectContentArrays(value: unknown, out: YouLearnContent[] = []): YouLearnContent[] {
  if (!value || typeof value !== 'object') return out;
  const record = value as Record<string, unknown>;
  for (const key of ['contents', 'children', 'items', 'videos', 'data'] as const) {
    const next = record[key];
    if (Array.isArray(next)) {
      out.push(...(next as YouLearnContent[]));
    } else if (next && typeof next === 'object') {
      collectContentArrays(next, out);
    }
  }
  return out;
}

function extractYouLearnSource(rawUrl: string): YouLearnSource | null {
  const input = rawUrl.trim();
  if (!input) return null;

  try {
    const url = new URL(input);
    if (!/(^|\.)youlearn\.ai$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) =>
      ['space', 'spaces', 'playlist', 'playlists', 'folder', 'folders', 'space_folder', 'space_folders'].includes(part),
    );
    const id = index >= 0 ? parts[index + 1] : null;
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
    const marker = parts[index];
    const kind = marker.includes('folder') ? 'folder' : marker.includes('playlist') ? 'playlist' : 'space';
    return { id, kind };
  } catch {
    return null;
  }
}

export function extractYouLearnSpaceId(rawUrl: string): string | null {
  return extractYouLearnSource(rawUrl)?.id ?? null;
}

function videoIdFor(content: YouLearnContent): string {
  const raw = content.content_id || content._id || content.content_url || content.title || '';
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

function duration(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function collectVideos(items: YouLearnContent[], importedAt: string, out: NewsYouLearnVideo[] = []): NewsYouLearnVideo[] {
  for (const item of items) {
    if (item?.type === 'video' && typeof item.content_url === 'string' && item.content_url.trim()) {
      out.push({
        id: videoIdFor(item),
        title: item.title?.trim() || 'YouLearn video',
        url: item.content_url.trim(),
        thumbnail: item.thumbnail_url?.trim() || undefined,
        durationSec: duration(item.length ?? item.duration),
        contentId: (item.content_id || item._id)?.trim() || undefined,
        importedAt,
      });
    }
    for (const key of ['contents', 'children', 'items'] as const) {
      const nested = item?.[key];
      if (Array.isArray(nested)) collectVideos(nested, importedAt, out);
    }
  }
  return out;
}

export async function fetchYouLearnSpaceVideos(spaceUrl: string): Promise<NewsYouLearnVideo[]> {
  const source = extractYouLearnSource(spaceUrl);
  if (!source) throw new Error('Paste a public YouLearn space, folder, or playlist link.');

  const candidates =
    source.kind === 'folder'
      ? [
          `https://api.youlearn.ai/space_folder/anonymous/${source.id}`,
          `https://api.youlearn.ai/space_folders/anonymous/${source.id}`,
          `https://api.youlearn.ai/folder/anonymous/${source.id}`,
          `https://api.youlearn.ai/space/anonymous/${source.id}`,
        ]
      : [`https://api.youlearn.ai/space/anonymous/${source.id}`];

  let data: unknown = null;
  let lastStatus = 0;
  for (const candidate of candidates) {
    const res = await fetch(candidate, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    lastStatus = res.status;
    if (res.ok) {
      data = await res.json();
      break;
    }
  }

  if (!data) {
    throw new Error(`YouLearn source could not be loaded (${lastStatus}). Make sure it is public.`);
  }

  const importedAt = new Date().toISOString();
  const seen = new Set<string>();
  return collectVideos(collectContentArrays(data), importedAt)
    .filter((video) => {
      const key = video.contentId || video.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 300);
}

export async function fetchYouLearnTranscript(contentId: string): Promise<YouLearnTranscriptSegment[]> {
  const cleanId = contentId.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanId)) return [];

  const res = await fetch('https://api.youlearn.ai/content/transcript', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-platform': 'web',
      Referer: 'https://app.youlearn.ai/',
    },
    body: JSON.stringify({ user_id: 'anonymous', content_id: cleanId }),
    cache: 'no-store',
  });
  if (!res.ok) return [];

  const chunks = (await res.json()) as YouLearnTranscriptChunk[];
  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk, fallbackIndex) => ({
      index: typeof chunk.idx === 'number' ? chunk.idx : fallbackIndex,
      startTime: typeof chunk.source === 'number' && Number.isFinite(chunk.source) && chunk.source >= 0 ? chunk.source : 0,
      text: typeof chunk.page_content === 'string' ? chunk.page_content.trim() : '',
    }))
    .filter((segment) => segment.text)
    .sort((a, b) => a.index - b.index);
}

export function transcriptToText(segments: YouLearnTranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join('\n').trim();
}

export function pickDailyYouLearnVideo(videos: NewsYouLearnVideo[], date: string): NewsYouLearnVideo | null {
  if (videos.length === 0) return null;
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  const days = Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : 0;
  return videos[Math.abs(days) % videos.length] ?? null;
}
