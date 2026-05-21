import { recordApiUsage } from './api-usage';

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export class DeepSeekConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekConfigError';
  }
}

export class DeepSeekRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DeepSeekRequestError';
    this.status = status;
  }
}

interface ChatCompletion {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getDeepSeekApiKey(): string {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new DeepSeekConfigError('DEEPSEEK_API_KEY is not configured.');
  }
  return apiKey;
}

async function runDeepSeekChat({
  system,
  user,
  maxTokens,
  operation,
}: {
  system: string;
  user: string;
  maxTokens: number;
  operation: string;
}): Promise<string> {
  const apiKey = getDeepSeekApiKey();

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        stream: false,
      }),
    });
  } catch (error) {
    throw new DeepSeekRequestError(`DeepSeek request failed: ${describeUnknownError(error)}`, 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new DeepSeekRequestError(
      `DeepSeek error ${res.status}: ${detail.slice(0, 200)}`,
      res.status,
    );
  }

  const data = (await res.json()) as ChatCompletion;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new DeepSeekRequestError('DeepSeek returned no content.', 502);
  }
  await recordApiUsage('deepseek', operation, data.usage?.total_tokens ?? estimateTokens(system, user, content));

  return content;
}

function estimateTokens(...parts: string[]): number {
  const chars = parts.reduce((sum, part) => sum + part.length, 0);
  return Math.max(1, Math.ceil(chars / 4));
}

export async function fetchVocabMeaning(word: string): Promise<string> {
  const cleaned = word.trim();
  if (!cleaned) {
    throw new Error('Word is empty.');
  }

  const system =
    'You are a concise English dictionary. Given a single word or short phrase, ' +
    'reply with: part of speech, a 1-2 sentence definition, and one short example. ' +
    'Plain text only. No markdown headings, no bullet points, no preamble.';

  return runDeepSeekChat({ system, user: cleaned, maxTokens: 220, operation: `Vocab meaning: ${cleaned}` });
}

export interface SavedVideoCategorizationInput {
  id: string;
  url: string;
  note: string;
}

export interface SavedVideoCategorizationContext {
  existingCategories?: string[];
}

export interface SavedVideoCategorization {
  id: string;
  category: string;
}

export interface SavedVideoNoteSearchInput {
  id: string;
  note: string;
}

export interface SavedVideoNoteSearchResult {
  id: string;
  confidence: number;
  reason: string;
}

export interface VideoTranscriptSummaryInput {
  videoId: string;
  transcript: string;
}

export interface TelegramTubeoIntentInput {
  text: string;
  replyText?: string;
  lastUrl?: string;
}

export type TelegramTubeoIntentAction =
  | { type: 'save_watch_later'; url: string; note?: string }
  | { type: 'update_watch_later_note'; url: string; note: string; mode?: 'replace' | 'append' }
  | { type: 'add_youtube_channel'; url: string }
  | { type: 'none'; reason?: string };

export interface TelegramTubeoIntent {
  actions: TelegramTubeoIntentAction[];
  summary: string;
}

const FALLBACK_SAVED_VIDEO_CATEGORY = 'Watch Later';
const CATEGORIZATION_BATCH_SIZE = 12;
const MAX_TRANSCRIPT_CHARS = 90_000;

function parseJsonPayload(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (directError) {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) {
      throw new DeepSeekRequestError('DeepSeek returned invalid JSON.', 502);
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      throw new DeepSeekRequestError(
        `DeepSeek returned malformed JSON: ${describeUnknownError(directError)}`,
        502,
      );
    }
  }
}

function isDeepSeekJsonPayloadError(error: unknown): error is DeepSeekRequestError {
  return (
    error instanceof DeepSeekRequestError &&
    error.status === 502 &&
    (error.message.startsWith('DeepSeek returned invalid JSON') ||
      error.message.startsWith('DeepSeek returned malformed JSON'))
  );
}

function normalizeTelegramTubeoIntentAction(value: unknown): TelegramTubeoIntentAction | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const type = typeof item.type === 'string' ? item.type.trim() : '';

  if (type === 'none') {
    return { type: 'none', reason: typeof item.reason === 'string' ? item.reason.slice(0, 160) : undefined };
  }

  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!url) return null;

  if (type === 'save_watch_later') {
    const note = typeof item.note === 'string' ? item.note.trim().slice(0, 1000) : '';
    return { type, url, ...(note ? { note } : {}) };
  }

  if (type === 'update_watch_later_note') {
    const note = typeof item.note === 'string' ? item.note.trim().slice(0, 1000) : '';
    if (!note) return null;
    const rawMode = typeof item.mode === 'string' ? item.mode.trim() : '';
    const mode = rawMode === 'append' ? 'append' : 'replace';
    return { type, url, note, mode };
  }

  if (type === 'add_youtube_channel') {
    return { type, url };
  }

  return null;
}

export async function parseTelegramTubeoIntent(input: TelegramTubeoIntentInput): Promise<TelegramTubeoIntent> {
  const text = input.text.trim();
  const replyText = input.replyText?.trim() || undefined;
  const lastUrl = input.lastUrl?.trim() || undefined;
  if (!text && !replyText && !lastUrl) {
    return { actions: [{ type: 'none', reason: 'empty input' }], summary: 'No Tubeo action.' };
  }

  const system =
    'You classify Telegram messages into Tubeo actions. ' +
    'Tubeo has a Watch Later page for YouTube, Instagram, and webpages, plus a channel list for YouTube channels. ' +
    'Return strict compact JSON only. No markdown, no comments.';

  const user = JSON.stringify({
    currentMessage: text,
    repliedToMessage: replyText ?? null,
    lastUrl: lastUrl ?? null,
    rules: [
      'If currentMessage contains any YouTube, Instagram, or webpage URL, add save_watch_later unless user clearly says not to save it.',
      'If user asks to update/change/replace note, emit update_watch_later_note using URL from currentMessage, repliedToMessage, or lastUrl.',
      'If user says add channel/chanl/chanle to Tubeo and target URL is YouTube, emit add_youtube_channel.',
      'One message can produce multiple actions.',
      'For notes, remove URLs and command words. Keep only the user note/tag text.',
      'For update_watch_later_note, use mode append only when user explicitly says append/add to existing note; otherwise replace.',
      'Always output concrete URL values, resolving pronouns like this/it from repliedToMessage or lastUrl.',
      'If there is no actionable Tubeo intent, output one none action.',
    ],
    outputShape:
      '{"actions":[{"type":"save_watch_later","url":"https://...","note":"optional"},{"type":"update_watch_later_note","url":"https://...","note":"...","mode":"replace|append"},{"type":"add_youtube_channel","url":"https://..."},{"type":"none","reason":"..."}],"summary":"short"}',
  });

  const content = await runDeepSeekChat({
    system,
    user,
    maxTokens: 900,
    operation: 'Telegram Tubeo ingest intent',
  });
  const parsed = parseJsonPayload(content) as
    | { actions?: unknown; summary?: unknown }
    | Array<unknown>;
  const rawActions = Array.isArray(parsed) ? parsed : parsed.actions;
  const actions = (Array.isArray(rawActions) ? rawActions : [])
    .map(normalizeTelegramTubeoIntentAction)
    .filter((item): item is TelegramTubeoIntentAction => Boolean(item));

  return {
    actions: actions.length > 0 ? actions : [{ type: 'none', reason: 'no valid action' }],
    summary: !Array.isArray(parsed) && typeof parsed.summary === 'string'
      ? parsed.summary.trim().slice(0, 200)
      : 'Tubeo intent parsed.',
  };
}

function categorizationMaxTokens(itemCount: number): number {
  return Math.min(2200, Math.max(1000, 420 + itemCount * 140));
}

async function categorizeSavedVideoBatch(
  items: SavedVideoCategorizationInput[],
  existingCategories: string[],
  system: string,
): Promise<SavedVideoCategorization[]> {
  const user = JSON.stringify({
    rules: [
      'Prefer the note/tag over URL.',
      'Group by semantic closeness across this batch and existingCategories.',
      'If two notes are about the same tool, skill, topic, creator, platform, or learning goal, use the same category.',
      'Do not split tiny differences into separate categories.',
      'Prefer existingCategories when close enough.',
      'If unclear, use "Watch Later".',
      'Return minified JSON only.',
    ],
    existingCategories,
    items,
  });

  try {
    const content = await runDeepSeekChat({
      system,
      user,
      maxTokens: categorizationMaxTokens(items.length),
      operation: `Saved videos categorize (${items.length} items)`,
    });
    const parsed = parseJsonPayload(content) as
      | { items?: Array<{ id?: unknown; category?: unknown }> }
      | Array<{ id?: unknown; category?: unknown }>;
    const itemsPayload = Array.isArray(parsed) ? parsed : parsed.items;

    return (itemsPayload ?? [])
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id.trim() : '',
        category: typeof item.category === 'string' ? item.category.trim() : '',
      }))
      .filter((item) => item.id && item.category)
      .map((item) => ({
        ...item,
        category: item.category.slice(0, 40),
      }));
  } catch (error) {
    if (!isDeepSeekJsonPayloadError(error)) {
      throw error;
    }

    if (items.length === 1) {
      return [{ id: items[0].id, category: FALLBACK_SAVED_VIDEO_CATEGORY }];
    }

    const midpoint = Math.ceil(items.length / 2);
    const first = await categorizeSavedVideoBatch(items.slice(0, midpoint), existingCategories, system);
    const categories = Array.from(new Set([...existingCategories, ...first.map((item) => item.category)]));
    const second = await categorizeSavedVideoBatch(items.slice(midpoint), categories, system);
    return [...first, ...second];
  }
}

export async function categorizeSavedVideos(
  items: SavedVideoCategorizationInput[],
  context: SavedVideoCategorizationContext = {},
): Promise<SavedVideoCategorization[]> {
  if (items.length === 0) return [];

  const system =
    'You categorize saved watch-later items from their user note/tag and URL. ' +
    'Cluster close items together instead of creating a fresh category for every item. ' +
    'Reuse an existing category when it is even moderately close. ' +
    'Create a new category only when the item clearly does not fit any existing or batch category. ' +
    'Prefer 4-8 broad reusable categories over many narrow one-off categories. ' +
    'Use short useful category names, 1-3 words, Title Case. ' +
    'Return strict JSON only with shape {"items":[{"id":"...","category":"..."}]}. ' +
    'No markdown, no comments, no extra keys. Return compact minified JSON.';

  const results: SavedVideoCategorization[] = [];
  let knownCategories = Array.from(new Set(context.existingCategories ?? []));

  for (let index = 0; index < items.length; index += CATEGORIZATION_BATCH_SIZE) {
    const batch = items.slice(index, index + CATEGORIZATION_BATCH_SIZE);
    const categorized = await categorizeSavedVideoBatch(batch, knownCategories, system);
    results.push(...categorized);
    knownCategories = Array.from(new Set([...knownCategories, ...categorized.map((item) => item.category)]));
  }

  return results;
}

export async function searchSavedVideosByNote(
  query: string,
  items: SavedVideoNoteSearchInput[],
): Promise<SavedVideoNoteSearchResult[]> {
  const cleaned = query.trim();
  if (!cleaned || items.length === 0) return [];

  const system =
    'You search saved videos using only the user note attached to each saved video. ' +
    'Do not infer relevance from URLs, titles, ids, categories, or external knowledge. ' +
    'Return only items whose note is strongly relevant to the query. ' +
    'Use confidence as an integer from 0 to 100. ' +
    'Return strict JSON only with shape {"items":[{"id":"...","confidence":90,"reason":"..."}]}. ' +
    'No markdown, no comments, no extra keys.';

  const user = JSON.stringify({
    query: cleaned,
    rules: [
      'Search note text only.',
      'Include item only when confidence is greater than or equal to 50.',
      'Sort by confidence descending.',
      'Reason must be short and based only on note text.',
    ],
    items: items.map((item) => ({ id: item.id, note: item.note })),
  });

  const content = await runDeepSeekChat({ system, user, maxTokens: 900, operation: 'Saved videos note search' });
  const parsed = parseJsonPayload(content) as
    | { items?: Array<{ id?: unknown; confidence?: unknown; reason?: unknown }> }
    | Array<{ id?: unknown; confidence?: unknown; reason?: unknown }>;
  const itemsPayload = Array.isArray(parsed) ? parsed : parsed.items;

  return (itemsPayload ?? [])
    .map((item) => {
      const confidence =
        typeof item.confidence === 'number'
          ? item.confidence
          : Number.parseFloat(typeof item.confidence === 'string' ? item.confidence : '');
      return {
        id: typeof item.id === 'string' ? item.id.trim() : '',
        confidence,
        reason: typeof item.reason === 'string' ? item.reason.trim() : '',
      };
    })
    .filter((item) => item.id && Number.isFinite(item.confidence) && item.confidence >= 50)
    .map((item) => ({
      id: item.id,
      confidence: Math.max(0, Math.min(100, Math.round(item.confidence))),
      reason: item.reason.slice(0, 160),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

export async function summarizeTranscriptForCitizen({
  videoId,
  transcript,
}: VideoTranscriptSummaryInput): Promise<string[]> {
  const cleaned = transcript.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    throw new DeepSeekRequestError('Transcript is empty.', 400);
  }

  const system =
    'You summarize a YouTube video transcript for an everyday citizen/viewer. ' +
    'Focus only on practical life impact: prices, bills, travel costs, rules, jobs, deadlines, benefits, risks, safety, health, or money. ' +
    'Write concrete bullet points with the important fact first. ' +
    'Do not include generic video commentary, intro, outro, sponsor, or vague opinions. ' +
    'Return strict JSON only with shape {"bullets":["..."]}. No markdown, no comments, no extra keys.';

  const user = JSON.stringify({
    videoId,
    instruction:
      'Get a bullet point summary of what is important to the citizen/viewer in his life. Examples: petrol price increased 20 rupees; flights will cost more by a stated amount.',
    transcript: cleaned.slice(0, MAX_TRANSCRIPT_CHARS),
  });

  const content = await runDeepSeekChat({ system, user, maxTokens: 900, operation: `Video summary: ${videoId}` });
  const parsed = parseJsonPayload(content) as { bullets?: unknown } | string[];
  const rawBullets = Array.isArray(parsed) ? parsed : parsed.bullets;

  const bullets = (Array.isArray(rawBullets) ? rawBullets : [])
    .map((item) => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : ''))
    .filter(Boolean)
    .slice(0, 8);

  if (bullets.length === 0) {
    throw new DeepSeekRequestError('DeepSeek returned no summary bullets.', 502);
  }

  return bullets;
}

export interface InsightsNewsSummaryInput {
  date: string; // 'YYYY-MM-DD' (IST)
  sourceUrl: string;
  articleText: string;
  userPrompt: string;
}

export interface InsightsNewsSummaryResult {
  /** Whatever JSON shape DeepSeek returns. The user's prompt dictates the structure. */
  data: unknown;
  /** Plain-text fallback rendered when `data` is missing/unrenderable. */
  raw: string;
  /** Was a user prompt actually applied (versus the built-in default). */
  usedUserPrompt: boolean;
}

const DEFAULT_INSIGHTS_NEWS_USER_PROMPT_HINT =
  'Return JSON in the shape {"sections":[{"heading":"...","bullets":["..."]}]}. ' +
  'Each section covers one news/topic from the page. Keep bullets concise.';

export async function summarizeInsightsOnIndiaPage({
  date,
  sourceUrl,
  articleText,
  userPrompt,
}: InsightsNewsSummaryInput): Promise<InsightsNewsSummaryResult> {
  const cleanedArticle = articleText.replace(/\s+\n/g, '\n').trim();
  if (!cleanedArticle) {
    throw new DeepSeekRequestError('Article text is empty.', 400);
  }

  const trimmedUserPrompt = userPrompt.trim();
  const usedUserPrompt = trimmedUserPrompt.length > 0;

  const system =
    'You summarize the daily InsightsOnIndia UPSC current-affairs page. ' +
    'Follow the user-provided output instructions exactly when given; otherwise use the default JSON shape. ' +
    'Return strict JSON only. No markdown, no commentary, no preamble. ' +
    (usedUserPrompt
      ? `User output instructions: ${trimmedUserPrompt}`
      : `Default: ${DEFAULT_INSIGHTS_NEWS_USER_PROMPT_HINT}`);

  const user = JSON.stringify({
    date,
    sourceUrl,
    article: cleanedArticle.slice(0, 60_000),
  });

  const content = await runDeepSeekChat({
    system,
    user,
    maxTokens: 3000,
    operation: `Insights news summary: ${date}`,
  });

  try {
    const parsed = parseJsonPayload(content);
    return { data: parsed, raw: content, usedUserPrompt };
  } catch {
    return { data: null, raw: content, usedUserPrompt };
  }
}
