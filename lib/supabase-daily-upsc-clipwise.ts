import 'server-only';

import type { NewsClipWiseProgress, NewsYouLearnVideo, NewsYouLearnVideoSummary } from './types';
import type { TubeoUserIdentity } from './supabase-sync';

const DEFAULT_TABLE = 'tubeo_daily_upsc_clipwise_tbl';

export type DailyUpscClipWiseCategory = 'upsc' | 'clipwise';

interface DailyUpscClipWiseRow {
  id?: string;
  owner_key: string;
  user_email: string;
  user_name: string | null;
  video_id: string;
  video_link: string;
  video_name: string;
  category: DailyUpscClipWiseCategory;
  marked_completed: boolean;
  completed_at?: string | null;
  llm_summary_generated: boolean;
  llm_summary?: unknown;
  llm_summary_raw?: string | null;
  llm_prompt_hash?: string | null;
  llm_generated_at?: string | null;
  summary_date?: string | null;
  clipwise_progress?: unknown;
  source_url?: string | null;
  thumbnail?: string | null;
  duration_sec: number;
  imported_at?: string | null;
  updated_at?: string;
}

export interface DailyUpscClipWiseRecord {
  video: NewsYouLearnVideo;
  category: DailyUpscClipWiseCategory;
  markedCompleted: boolean;
  summary: NewsYouLearnVideoSummary | null;
  clipwiseProgress: NewsClipWiseProgress | null;
  sourceUrl: string;
}

interface UpsertDailyUpscClipWiseInput {
  category: DailyUpscClipWiseCategory;
  video: NewsYouLearnVideo;
  sourceUrl?: string;
  markedCompleted?: boolean;
  summary?: NewsYouLearnVideoSummary | null;
  clipwiseProgress?: NewsClipWiseProgress | null;
}

function config(): { url: string; key: string; table: string } | null {
  const url = process.env.TUBEO_SUPABASE_URL?.trim();
  const key =
    process.env.TUBEO_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_SECRET_KEY?.trim();
  const table = process.env.TUBEO_SUPABASE_DAILY_UPSC_CLIPWISE_TABLE?.trim() || DEFAULT_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, table };
}

export function isSupabaseDailyUpscClipWiseConfigured(): boolean {
  return Boolean(config());
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

function tableUrl(baseUrl: string, table: string): string {
  return `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
}

function rowFromInput(identity: TubeoUserIdentity, input: UpsertDailyUpscClipWiseInput): DailyUpscClipWiseRow {
  const summary = input.summary ?? null;
  const progress = input.clipwiseProgress ?? null;
  const completedAt = input.video.completedAt || progress?.completedAt || null;
  return {
    owner_key: identity.ownerKey,
    user_email: identity.email,
    user_name: identity.name,
    video_id: input.video.id,
    video_link: input.video.url,
    video_name: input.video.title,
    category: input.category,
    marked_completed: input.markedCompleted ?? Boolean(completedAt),
    completed_at: completedAt,
    llm_summary_generated: Boolean(summary),
    llm_summary: summary?.data ?? null,
    llm_summary_raw: summary?.raw ?? null,
    llm_prompt_hash: summary?.promptHash ?? null,
    llm_generated_at: summary?.generatedAt ?? null,
    summary_date: summary?.date ?? null,
    clipwise_progress: progress ?? {},
    source_url: input.sourceUrl?.trim() || null,
    thumbnail: input.video.thumbnail ?? null,
    duration_sec: Math.max(0, Math.round(input.video.durationSec || 0)),
    imported_at: input.video.importedAt || null,
  };
}

function normalizeProgress(value: unknown): NewsClipWiseProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<NewsClipWiseProgress>;
  const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
  if (!videoId) return null;
  const clipSeconds =
    typeof item.clipSeconds === 'number' && Number.isFinite(item.clipSeconds) && item.clipSeconds > 0
      ? Math.min(3600, Math.round(item.clipSeconds))
      : 120;
  return {
    videoId,
    clipSeconds,
    done: [
      ...new Set(
        (Array.isArray(item.done) ? item.done : [])
          .filter((index) => Number.isInteger(index) && index >= 0)
          .map((index) => Math.round(index)),
      ),
    ].sort((a, b) => a - b),
    lastClipIndex:
      typeof item.lastClipIndex === 'number' && Number.isFinite(item.lastClipIndex) && item.lastClipIndex >= 0
        ? Math.round(item.lastClipIndex)
        : 0,
    completedAt:
      typeof item.completedAt === 'string' && item.completedAt.trim()
        ? item.completedAt
        : undefined,
    updatedAt:
      typeof item.updatedAt === 'string' && item.updatedAt.trim()
        ? item.updatedAt
        : new Date(0).toISOString(),
  };
}

function normalizeRow(row: DailyUpscClipWiseRow): DailyUpscClipWiseRecord | null {
  const videoId = row.video_id?.trim();
  const videoLink = row.video_link?.trim();
  if (!videoId || !videoLink) return null;
  const video: NewsYouLearnVideo = {
    id: videoId,
    title: row.video_name?.trim() || 'Video',
    url: videoLink,
    thumbnail: row.thumbnail?.trim() || undefined,
    durationSec: Math.max(0, Math.round(row.duration_sec || 0)),
    importedAt: row.imported_at || row.updated_at || new Date(0).toISOString(),
    completedAt: row.completed_at || undefined,
  };
  const summary: NewsYouLearnVideoSummary | null =
    row.llm_summary_generated && row.summary_date
      ? {
          date: row.summary_date,
          videoId,
          videoTitle: video.title,
          videoUrl: video.url,
          thumbnail: video.thumbnail,
          data: row.llm_summary ?? null,
          raw: row.llm_summary_raw ?? '',
          promptHash: row.llm_prompt_hash ?? '',
          generatedAt: row.llm_generated_at ?? row.updated_at ?? new Date(0).toISOString(),
        }
      : null;

  return {
    video,
    category: row.category,
    markedCompleted: Boolean(row.marked_completed),
    summary,
    clipwiseProgress: normalizeProgress(row.clipwise_progress),
    sourceUrl: row.source_url?.trim() || '',
  };
}

export async function readDailyUpscClipWiseRecords(
  identity: TubeoUserIdentity,
): Promise<DailyUpscClipWiseRecord[]> {
  const cfg = config();
  if (!cfg) return [];

  const qs = new URLSearchParams({
    owner_key: `eq.${identity.ownerKey}`,
    select: '*',
    order: 'updated_at.desc',
    limit: '1000',
  });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    headers: headers(cfg.key),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Daily UPSC/ClipWise read failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await res.json()) as DailyUpscClipWiseRow[];
  return rows.map(normalizeRow).filter((item): item is DailyUpscClipWiseRecord => Boolean(item));
}

export async function upsertDailyUpscClipWiseRecord(
  identity: TubeoUserIdentity,
  input: UpsertDailyUpscClipWiseInput,
): Promise<void> {
  const cfg = config();
  if (!cfg) return;

  const row = rowFromInput(identity, input);
  const qs = new URLSearchParams({ on_conflict: 'owner_key,category,video_id' });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'POST',
    headers: {
      ...headers(cfg.key),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Daily UPSC/ClipWise write failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

export async function deleteDailyUpscClipWiseRecord(
  identity: TubeoUserIdentity,
  category: DailyUpscClipWiseCategory,
  videoId: string,
): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  const qs = new URLSearchParams({
    owner_key: `eq.${identity.ownerKey}`,
    category: `eq.${category}`,
    video_id: `eq.${videoId}`,
  });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'DELETE',
    headers: headers(cfg.key),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Daily UPSC/ClipWise delete failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

export async function clearDailyUpscClipWiseRecords(
  identity: TubeoUserIdentity,
  category: DailyUpscClipWiseCategory,
): Promise<void> {
  const cfg = config();
  if (!cfg) return;
  const qs = new URLSearchParams({
    owner_key: `eq.${identity.ownerKey}`,
    category: `eq.${category}`,
  });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'DELETE',
    headers: headers(cfg.key),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Daily UPSC/ClipWise clear failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}
