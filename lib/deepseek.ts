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

  const res = await fetch(DEEPSEEK_API_URL, {
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
      stream: false,
    }),
  });

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

export interface SavedVideoCategorization {
  id: string;
  category: string;
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new DeepSeekRequestError('DeepSeek returned invalid JSON.', 502);
    return JSON.parse(match[0]);
  }
}

export async function categorizeSavedVideos(
  items: SavedVideoCategorizationInput[],
): Promise<SavedVideoCategorization[]> {
  if (items.length === 0) return [];

  const system =
    'You categorize saved watch-later items from their user note/tag and URL. ' +
    'Use short useful category names, 1-3 words, Title Case. ' +
    'Return strict JSON only with shape {"items":[{"id":"...","category":"..."}]}. ' +
    'No markdown, no comments, no extra keys.';

  const user = JSON.stringify({
    rules: [
      'Prefer the note/tag over URL.',
      'Group similar intent into reusable categories.',
      'If unclear, use "Watch Later".',
    ],
    items,
  });

  const content = await runDeepSeekChat({ system, user, maxTokens: 700 });
  const parsed = parseJsonObject(content) as {
    items?: Array<{ id?: unknown; category?: unknown }>;
  };

  return (parsed.items ?? [])
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id.trim() : '',
      category: typeof item.category === 'string' ? item.category.trim() : '',
    }))
    .filter((item) => item.id && item.category)
    .map((item) => ({
      ...item,
      category: item.category.slice(0, 40),
    }));
}
