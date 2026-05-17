import 'server-only';

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * IST is UTC+05:30. Returns the calendar date in IST that contains `now`.
 */
export function istDateParts(now: Date = new Date()): { y: number; m: number; d: number } {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return {
    y: ist.getUTCFullYear(),
    m: ist.getUTCMonth() + 1,
    d: ist.getUTCDate(),
  };
}

export function istDateString(now: Date = new Date()): string {
  const { y, m, d } = istDateParts(now);
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

export function parseIstDateString(value: string): { y: number; m: number; d: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Builds the canonical InsightsOnIndia UPSC current-affairs URL for an IST date.
 * Example: https://www.insightsonindia.com/2026/05/15/upsc-current-affairs-15-may-2026/
 */
export function insightsOnIndiaUrl(date: string | { y: number; m: number; d: number }): string {
  const parts = typeof date === 'string' ? parseIstDateString(date) : date;
  if (!parts) {
    throw new Error(`Invalid date for InsightsOnIndia URL: ${String(date)}`);
  }
  const { y, m, d } = parts;
  const month = MONTH_NAMES[m - 1];
  const yyyy = y.toString().padStart(4, '0');
  const mm = m.toString().padStart(2, '0');
  const dd = d.toString().padStart(2, '0');
  return `https://www.insightsonindia.com/${yyyy}/${mm}/${dd}/upsc-current-affairs-${d}-${month}-${y}/`;
}

export interface FetchNewsHtmlResult {
  status: 'ok' | 'missing' | 'error';
  url: string;
  html?: string;
  httpStatus?: number;
  error?: string;
}

/**
 * Fetches the InsightsOnIndia page for the given IST date.
 * Returns `missing` for 404/410 (page not yet published), `error` for other failures.
 * Uses Next 1h revalidation to dedupe duplicate fetches inside Vercel.
 */
export async function fetchInsightsOnIndiaHtml(date: string): Promise<FetchNewsHtmlResult> {
  const url = insightsOnIndiaUrl(date);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'TubeoNewsBot/1.0 (+https://github.com/Sarvesh-Kesharwani/tubeo) Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml',
      },
      next: { revalidate: 60 * 60 },
    });
  } catch (error) {
    return { status: 'error', url, error: (error as Error).message };
  }

  if (res.status === 404 || res.status === 410) {
    return { status: 'missing', url, httpStatus: res.status };
  }
  if (!res.ok) {
    return { status: 'error', url, httpStatus: res.status, error: `HTTP ${res.status}` };
  }

  const html = await res.text();
  // Some hosts return a soft-404 with 200. Detect a common pattern.
  if (/Page not found/i.test(html.slice(0, 4000)) && !/upsc-current-affairs/i.test(html.slice(0, 4000))) {
    return { status: 'missing', url, httpStatus: 200 };
  }

  return { status: 'ok', url, html };
}

/**
 * Strips InsightsOnIndia HTML down to the article body to keep DeepSeek token usage bounded.
 * Falls back to a slice of the raw HTML if no obvious article container is found.
 */
export function extractInsightsArticleText(html: string, maxChars = 60_000): string {
  if (!html) return '';

  // Try to locate the main article container.
  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
    html.match(/<div[^>]*class="[^"]*(?:entry-content|td-post-content|post-content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/(?:section|div|article|main)>/i);

  const fragment = articleMatch ? articleMatch[1] : html;

  const cleaned = fragment
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<\/(p|li|h[1-6]|tr|div|section)>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}\n\n…[truncated]` : cleaned;
}
