import 'server-only';

import { createHash } from 'crypto';
import { summarizeInsightsOnIndiaPage, DeepSeekRequestError } from './deepseek';
import {
  extractInsightsArticleText,
  fetchInsightsOnIndiaHtml,
  insightsOnIndiaUrl,
  istDateString,
} from './news-source';
import {
  isSupabaseNewsConfigured,
  readNewsRaw,
  readNewsState,
  writeNewsRaw,
  writeNewsSummary,
  type NewsStatePayload,
  type NewsSummaryEntry,
} from './supabase-news';
import type { TubeoUserIdentity } from './supabase-sync';

export type NewsLoadStatus =
  | 'ok'
  | 'ready'
  | 'no-config'
  | 'no-html-yet'
  | 'no-prompt'
  | 'deepseek-failed'
  | 'fetch-failed';

export interface NewsLoadResult {
  date: string;
  sourceUrl: string;
  status: NewsLoadStatus;
  summary: NewsSummaryEntry | null;
  rawFetchedAt?: string;
  /** Error detail when status is failed. */
  error?: string;
  /** True if a fresh DeepSeek call was made on this request. */
  regenerated: boolean;
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function pickSummary(
  state: NewsStatePayload | null,
  date: string,
  promptH: string,
): NewsSummaryEntry | null {
  const entry = state?.summaries[date];
  if (!entry) return null;
  // If the user's prompt has changed since this summary was generated, treat it as stale.
  if (entry.promptHash !== promptH) return null;
  return entry;
}

async function ensureRawHtml(date: string): Promise<{ html: string | null; sourceUrl: string; fetchedAt?: string }> {
  const sourceUrl = insightsOnIndiaUrl(date);

  try {
    const cached = await readNewsRaw(date);
    if (cached && cached.html.length > 2000) {
      return { html: cached.html, sourceUrl: cached.url || sourceUrl, fetchedAt: cached.fetchedAt };
    }
  } catch {
    // Fall through to live fetch.
  }

  const live = await fetchInsightsOnIndiaHtml(date, sourceUrl);
  if (live.status !== 'ok' || !live.html) {
    return { html: null, sourceUrl: live.url || sourceUrl };
  }

  try {
    await writeNewsRaw({
      date,
      url: live.url || sourceUrl,
      html: live.html,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    // Cache write is best-effort.
  }

  return { html: live.html, sourceUrl: live.url || sourceUrl };
}

/**
 * Reads the cached summary for `date`, or generates a fresh one using the user's
 * current prompt. If the prompt is empty, returns `no-prompt` and does NOT call
 * DeepSeek — the user must set a prompt first.
 */
export async function loadNewsForUser(
  identity: TubeoUserIdentity,
  options: { date?: string; forceRegenerate?: boolean } = {},
): Promise<NewsLoadResult> {
  const date = options.date ?? istDateString();
  const sourceUrl = insightsOnIndiaUrl(date);

  if (!isSupabaseNewsConfigured()) {
    return { date, sourceUrl, status: 'no-config', summary: null, regenerated: false };
  }

  const state = await readNewsState(identity);
  const prompt = state?.prompt ?? '';
  const promptH = promptHash(prompt);

  if (!options.forceRegenerate) {
    const existing = pickSummary(state, date, promptH);
    if (existing) {
      return {
        date,
        sourceUrl: existing.sourceUrl || sourceUrl,
        status: 'ok',
        summary: existing,
        regenerated: false,
      };
    }
  }

  if (!prompt.trim()) {
    return { date, sourceUrl, status: 'no-prompt', summary: null, regenerated: false };
  }

  const { html, sourceUrl: resolvedUrl, fetchedAt } = await ensureRawHtml(date);
  if (!html) {
    return {
      date,
      sourceUrl: resolvedUrl,
      status: 'no-html-yet',
      summary: null,
      regenerated: false,
    };
  }

  const articleText = extractInsightsArticleText(html);
  if (articleText.length < 500) {
    return {
      date,
      sourceUrl: resolvedUrl,
      status: 'no-html-yet',
      summary: null,
      regenerated: false,
      rawFetchedAt: fetchedAt,
    };
  }

  let summaryResult: Awaited<ReturnType<typeof summarizeInsightsOnIndiaPage>>;
  try {
    summaryResult = await summarizeInsightsOnIndiaPage({
      date,
      sourceUrl: resolvedUrl,
      articleText,
      userPrompt: prompt,
    });
  } catch (error) {
    return {
      date,
      sourceUrl: resolvedUrl,
      status: 'deepseek-failed',
      summary: null,
      error: error instanceof DeepSeekRequestError ? error.message : (error as Error).message,
      regenerated: false,
      rawFetchedAt: fetchedAt,
    };
  }

  const entry: NewsSummaryEntry = {
    date,
    sourceUrl: resolvedUrl,
    data: summaryResult.data,
    raw: summaryResult.raw,
    usedUserPrompt: summaryResult.usedUserPrompt,
    promptHash: promptH,
    generatedAt: new Date().toISOString(),
  };

  try {
    await writeNewsSummary(identity, entry, prompt);
  } catch (error) {
    // Persisting failed — still return the freshly generated summary so the UI shows something.
    return {
      date,
      sourceUrl: resolvedUrl,
      status: 'ok',
      summary: entry,
      regenerated: true,
      error: `Failed to persist summary: ${(error as Error).message}`,
      rawFetchedAt: fetchedAt,
    };
  }

  return {
    date,
    sourceUrl: resolvedUrl,
    status: 'ok',
    summary: entry,
    regenerated: true,
    rawFetchedAt: fetchedAt,
  };
}

/**
 * Reads already-generated state only. No source-page fetch, no DeepSeek call.
 * The "Fetch today's Insights" button is the only path that performs work.
 */
export async function readNewsForUser(
  identity: TubeoUserIdentity,
  options: { date?: string } = {},
): Promise<NewsLoadResult> {
  const date = options.date ?? istDateString();
  const sourceUrl = insightsOnIndiaUrl(date);

  if (!isSupabaseNewsConfigured()) {
    return { date, sourceUrl, status: 'no-config', summary: null, regenerated: false };
  }

  const state = await readNewsState(identity);
  const prompt = state?.prompt ?? '';
  if (!prompt.trim()) {
    return { date, sourceUrl, status: 'no-prompt', summary: null, regenerated: false };
  }

  const existing = pickSummary(state, date, promptHash(prompt));
  if (existing) {
    return {
      date,
      sourceUrl: existing.sourceUrl || sourceUrl,
      status: 'ok',
      summary: existing,
      regenerated: false,
    };
  }

  return { date, sourceUrl, status: 'ready', summary: null, regenerated: false };
}

/**
 * Fetch, extract, and summarize an InsightsOnIndia article from a manual URL.
 * Bypasses date-based URL construction and Supabase raw HTML caching.
 */
export async function loadNewsFromUrl(
  identity: TubeoUserIdentity,
  rawUrl: string,
): Promise<NewsLoadResult> {
  const sourceUrl = rawUrl.trim();

  if (!isSupabaseNewsConfigured()) {
    return { date: '', sourceUrl, status: 'no-config', summary: null, regenerated: false };
  }

  const state = await readNewsState(identity);
  const prompt = state?.prompt ?? '';
  if (!prompt.trim()) {
    return { date: '', sourceUrl, status: 'no-prompt', summary: null, regenerated: false };
  }

  // Fetch the HTML directly
  let html: string;
  try {
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent':
          'TubeoNewsBot/1.0 (+https://github.com/Sarvesh-Kesharwani/tubeo) Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      return { date: '', sourceUrl, status: 'fetch-failed', summary: null, regenerated: false, error: `HTTP ${res.status}` };
    }
    html = await res.text();
  } catch (error) {
    return { date: '', sourceUrl, status: 'fetch-failed', summary: null, regenerated: false, error: (error as Error).message };
  }

  const articleText = extractInsightsArticleText(html);
  if (articleText.length < 500) {
    return { date: '', sourceUrl, status: 'no-html-yet', summary: null, regenerated: false };
  }

  // Derive date from URL if it matches the InsightsOnIndia pattern, otherwise use today
  const urlDateMatch = sourceUrl.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  const date = urlDateMatch ? `${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}` : istDateString();

  let summaryResult: Awaited<ReturnType<typeof summarizeInsightsOnIndiaPage>>;
  try {
    summaryResult = await summarizeInsightsOnIndiaPage({
      date,
      sourceUrl,
      articleText,
      userPrompt: prompt,
    });
  } catch (error) {
    return {
      date,
      sourceUrl,
      status: 'deepseek-failed',
      summary: null,
      error: error instanceof DeepSeekRequestError ? error.message : (error as Error).message,
      regenerated: false,
    };
  }

  const promptH = promptHash(prompt);
  const entry: NewsSummaryEntry = {
    date,
    sourceUrl,
    data: summaryResult.data,
    raw: summaryResult.raw,
    usedUserPrompt: summaryResult.usedUserPrompt,
    promptHash: promptH,
    generatedAt: new Date().toISOString(),
  };

  try {
    await writeNewsSummary(identity, entry, prompt);
  } catch {
    // Best-effort persist
  }

  return { date, sourceUrl, status: 'ok', summary: entry, regenerated: true };
}
