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

export async function fetchVocabMeaning(word: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new DeepSeekConfigError('DEEPSEEK_API_KEY is not configured.');
  }

  const cleaned = word.trim();
  if (!cleaned) {
    throw new Error('Word is empty.');
  }

  const system =
    'You are a concise English dictionary. Given a single word or short phrase, ' +
    'reply with: part of speech, a 1-2 sentence definition, and one short example. ' +
    'Plain text only. No markdown headings, no bullet points, no preamble.';

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
        { role: 'user', content: cleaned },
      ],
      temperature: 0.2,
      max_tokens: 220,
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
  const meaning = data.choices?.[0]?.message?.content?.trim();
  if (!meaning) {
    throw new DeepSeekRequestError('DeepSeek returned no content.', 502);
  }

  return meaning;
}
