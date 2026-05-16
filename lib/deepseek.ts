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
}: {
  system: string;
  user: string;
  maxTokens: number;
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

  return content;
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

  return runDeepSeekChat({ system, user: cleaned, maxTokens: 220 });
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

const FALLBACK_SAVED_VIDEO_CATEGORY = 'Watch Later';
const CATEGORIZATION_BATCH_SIZE = 12;

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
      'Include item only when confidence is greater than 75.',
      'Sort by confidence descending.',
      'Reason must be short and based only on note text.',
    ],
    items: items.map((item) => ({ id: item.id, note: item.note })),
  });

  const content = await runDeepSeekChat({ system, user, maxTokens: 900 });
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
    .filter((item) => item.id && Number.isFinite(item.confidence) && item.confidence > 75)
    .map((item) => ({
      id: item.id,
      confidence: Math.max(0, Math.min(100, Math.round(item.confidence))),
      reason: item.reason.slice(0, 160),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
