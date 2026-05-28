import 'server-only';

import type { TubeoUserIdentity } from './supabase-sync';

const DEFAULT_STATE_TABLE = 'tubeo_news_state';
const DEFAULT_RAW_TABLE = 'tubeo_news_raw';
const MAX_PROMPT_CHARS = 8000;
const MAX_SUMMARY_HISTORY = 60;

export interface NewsSummaryEntry {
  date: string;
  sourceUrl: string;
  data: unknown;
  raw: string;
  usedUserPrompt: boolean;
  promptHash: string;
  generatedAt: string;
}

export interface NewsStatePayload {
  prompt: string;
  summaries: Record<string, NewsSummaryEntry>;
  updatedAt: string;
}

export interface NewsRawEntry {
  date: string;
  url: string;
  html: string;
  fetchedAt: string;
}

interface SupabaseNewsStateRow {
  owner_key: string;
  user_email: string;
  user_name: string | null;
  prompt: string;
  summaries: Record<string, NewsSummaryEntry>;
  updated_at?: string;
}

interface SupabaseNewsRawRow {
  date: string;
  url: string;
  html: string;
  fetched_at?: string;
}

interface SupabaseNewsConfig {
  url: string;
  key: string;
  accessToken?: string;
  table: string;
}

function newsKey(): string {
  return (
    process.env.TUBEO_SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_SECRET_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_NEWS_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_ANON_KEY?.trim() ||
    process.env.TUBEO_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ''
  );
}

function newsAccessToken(): string {
  return process.env.TUBEO_SUPABASE_NEWS_ACCESS_TOKEN?.trim() || '';
}

function stateConfig(): SupabaseNewsConfig | null {
  const url = process.env.TUBEO_SUPABASE_URL?.trim();
  const key = newsKey();
  const accessToken = newsAccessToken();
  const table = process.env.TUBEO_SUPABASE_NEWS_STATE_TABLE?.trim() || DEFAULT_STATE_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, accessToken, table };
}

function rawConfig(): SupabaseNewsConfig | null {
  const url = process.env.TUBEO_SUPABASE_URL?.trim();
  const key = newsKey();
  const accessToken = newsAccessToken();
  const table = process.env.TUBEO_SUPABASE_NEWS_RAW_TABLE?.trim() || DEFAULT_RAW_TABLE;

  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, accessToken, table };
}

export function isSupabaseNewsConfigured(): boolean {
  return Boolean(stateConfig()) && Boolean(rawConfig());
}

function headers(cfg: SupabaseNewsConfig) {
  const out: Record<string, string> = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
  };
  if (cfg.accessToken) out['x-tubeo-news-token'] = cfg.accessToken;
  return out;
}

function tableUrl(baseUrl: string, table: string): string {
  return `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 5000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function trimPrompt(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').slice(0, MAX_PROMPT_CHARS);
}

function normalizeSummaryEntry(entry: NewsSummaryEntry | null | undefined): NewsSummaryEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const date = typeof entry.date === 'string' ? entry.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date,
    sourceUrl: typeof entry.sourceUrl === 'string' ? entry.sourceUrl : '',
    data: entry.data ?? null,
    raw: typeof entry.raw === 'string' ? entry.raw : '',
    usedUserPrompt: Boolean(entry.usedUserPrompt),
    promptHash: typeof entry.promptHash === 'string' ? entry.promptHash : '',
    generatedAt: typeof entry.generatedAt === 'string' ? entry.generatedAt : new Date().toISOString(),
  };
}

function normalizeSummaries(value: unknown): Record<string, NewsSummaryEntry> {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.values(value as Record<string, unknown>) as Array<NewsSummaryEntry | null>;
  const out: Record<string, NewsSummaryEntry> = {};
  for (const entry of entries) {
    const normalized = normalizeSummaryEntry(entry);
    if (normalized) out[normalized.date] = normalized;
  }
  const sortedKeys = Object.keys(out).sort().reverse();
  const trimmedKeys = sortedKeys.slice(0, MAX_SUMMARY_HISTORY);
  if (trimmedKeys.length === sortedKeys.length) return out;
  const trimmed: Record<string, NewsSummaryEntry> = {};
  for (const k of trimmedKeys) trimmed[k] = out[k];
  return trimmed;
}

export async function readNewsState(
  identity: TubeoUserIdentity,
): Promise<NewsStatePayload | null> {
  const cfg = stateConfig();
  if (!cfg) return null;

  const qs = new URLSearchParams({
    owner_key: `eq.${identity.ownerKey}`,
    select: 'owner_key,user_email,user_name,prompt,summaries,updated_at',
    limit: '1',
  });

  const res = await fetchWithTimeout(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    headers: headers(cfg),
    cache: 'no-store',
  });

  if (!res || !res.ok) return null;

  const rows = (await res.json()) as SupabaseNewsStateRow[];
  const row = rows[0];
  if (!row) return null;

  return {
    prompt: trimPrompt(row.prompt),
    summaries: normalizeSummaries(row.summaries),
    updatedAt: row.updated_at || new Date(0).toISOString(),
  };
}

async function writeNewsStateRow(
  identity: TubeoUserIdentity,
  prompt: string,
  summaries: Record<string, NewsSummaryEntry>,
): Promise<NewsStatePayload> {
  const cfg = stateConfig();
  if (!cfg) throw new Error('Tubeo Supabase news sync is not configured.');

  const row: SupabaseNewsStateRow = {
    owner_key: identity.ownerKey,
    user_email: identity.email,
    user_name: identity.name,
    prompt: trimPrompt(prompt),
    summaries: normalizeSummaries(summaries),
  };
  const qs = new URLSearchParams({ on_conflict: 'owner_key' });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'POST',
    headers: {
      ...headers(cfg),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase news state write failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const rows = (await res.json()) as SupabaseNewsStateRow[];
  const returned = rows[0];
  return {
    prompt: trimPrompt(returned?.prompt ?? row.prompt),
    summaries: normalizeSummaries(returned?.summaries ?? row.summaries),
    updatedAt: returned?.updated_at || new Date().toISOString(),
  };
}

export async function writeNewsPrompt(
  identity: TubeoUserIdentity,
  prompt: string,
): Promise<NewsStatePayload> {
  const existing = (await readNewsState(identity)) ?? {
    prompt: '',
    summaries: {},
    updatedAt: new Date(0).toISOString(),
  };
  return writeNewsStateRow(identity, prompt, existing.summaries);
}

export async function writeNewsSummary(
  identity: TubeoUserIdentity,
  entry: NewsSummaryEntry,
): Promise<NewsStatePayload> {
  const existing = (await readNewsState(identity)) ?? {
    prompt: '',
    summaries: {},
    updatedAt: new Date(0).toISOString(),
  };
  const normalized = normalizeSummaryEntry(entry);
  if (!normalized) throw new Error('Invalid news summary entry.');
  const nextSummaries = { ...existing.summaries, [normalized.date]: normalized };
  return writeNewsStateRow(identity, existing.prompt, nextSummaries);
}

export async function deleteNewsSummary(
  identity: TubeoUserIdentity,
  date: string,
): Promise<NewsStatePayload> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid news summary date.');
  }

  const existing = (await readNewsState(identity)) ?? {
    prompt: '',
    summaries: {},
    updatedAt: new Date(0).toISOString(),
  };
  const nextSummaries = { ...existing.summaries };
  delete nextSummaries[date];
  return writeNewsStateRow(identity, existing.prompt, nextSummaries);
}

export async function readNewsRaw(date: string): Promise<NewsRawEntry | null> {
  const cfg = rawConfig();
  if (!cfg) return null;

  const qs = new URLSearchParams({
    date: `eq.${date}`,
    select: 'date,url,html,fetched_at',
    limit: '1',
  });

  const res = await fetchWithTimeout(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    headers: headers(cfg),
    cache: 'no-store',
  });

  if (!res || !res.ok) return null;

  const rows = (await res.json()) as SupabaseNewsRawRow[];
  const row = rows[0];
  if (!row) return null;

  return {
    date: row.date,
    url: row.url,
    html: row.html,
    fetchedAt: row.fetched_at || new Date(0).toISOString(),
  };
}

export async function writeNewsRaw(entry: NewsRawEntry): Promise<void> {
  const cfg = rawConfig();
  if (!cfg) throw new Error('Tubeo Supabase news raw cache is not configured.');

  const row: SupabaseNewsRawRow = {
    date: entry.date,
    url: entry.url,
    html: entry.html,
    fetched_at: entry.fetchedAt,
  };
  const qs = new URLSearchParams({ on_conflict: 'date' });
  const res = await fetch(`${tableUrl(cfg.url, cfg.table)}?${qs}`, {
    method: 'POST',
    headers: {
      ...headers(cfg),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase news raw write failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}
