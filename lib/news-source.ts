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

const INSIGHTSONINDIA_BASE_URL =
  'https://www.insightsonindia.com/2026/05/12/upsc-current-affairs-12-may-2026/';
const INSIGHTSONINDIA_TYPO_BASE_URL =
  'https://www.insightsonindia.com/2026/05/12/upsc-currrent-affairs-12-may-2026/';

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
  const checked = new Date(Date.UTC(y, m - 1, d));
  if (
    checked.getUTCFullYear() !== y ||
    checked.getUTCMonth() !== m - 1 ||
    checked.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

/**
 * Builds the canonical InsightsOnIndia UPSC current-affairs URL for an IST date.
 * Example: https://www.insightsonindia.com/2026/05/15/upsc-current-affairs-15-may-2026/
 */
export function insightsOnIndiaUrl(date: string | { y: number; m: number; d: number }): string {
  return buildInsightsOnIndiaUrl(date, INSIGHTSONINDIA_BASE_URL, 'upsc-current-affairs');
}

function buildInsightsOnIndiaUrl(
  date: string | { y: number; m: number; d: number },
  baseUrl: string,
  slugPrefix: string,
): string {
  const parts = typeof date === 'string' ? parseIstDateString(date) : date;
  if (!parts) {
    throw new Error(`Invalid date for InsightsOnIndia URL: ${String(date)}`);
  }
  const { y, m, d } = parts;
  const month = MONTH_NAMES[m - 1];
  const yyyy = y.toString().padStart(4, '0');
  const mm = m.toString().padStart(2, '0');
  const dd = d.toString().padStart(2, '0');
  return baseUrl
    .replace('/2026/05/12/', `/${yyyy}/${mm}/${dd}/`)
    .replace(`${slugPrefix}-12-may-2026`, `${slugPrefix}-${d}-${month}-${yyyy}`);
}

function insightsOnIndiaUrlCandidates(date: string | { y: number; m: number; d: number }): string[] {
  const standard = insightsOnIndiaUrl(date);
  const typo = buildInsightsOnIndiaUrl(date, INSIGHTSONINDIA_TYPO_BASE_URL, 'upsc-currrent-affairs');
  return standard === typo ? [standard] : [standard, typo];
}

const LANDING_PAGE_URL = 'https://www.insightsonindia.com/current-affairs-upsc/';

/**
 * Fetches the InsightsOnIndia current-affairs landing page and extracts the URL
 * of the latest available daily article. Falls back to the date-based URL if
 * the landing page is unreachable or no links are found.
 */
export async function fetchLatestInsightsUrl(): Promise<string> {
  try {
    const res = await fetch(LANDING_PAGE_URL, {
      headers: {
        'User-Agent':
          'TubeoNewsBot/1.0 (+https://github.com/Sarvesh-Kesharwani/tubeo) Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const pattern = /https?:\/\/www\.insightsonindia\.com\/\d{4}\/\d{2}\/\d{2}\/upsc-cur{1,3}rent-affairs-\d+-[a-z]+-\d{4}\//gi;
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      return matches[0];
    }
  } catch {
    // Fall through to date-based URL.
  }
  return insightsOnIndiaUrl(istDateString());
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
export async function fetchInsightsOnIndiaHtml(
  date: string,
  explicitUrl?: string,
): Promise<FetchNewsHtmlResult> {
  const candidates = insightsOnIndiaUrlCandidates(date);
  const urls = explicitUrl
    ? [explicitUrl, ...candidates.filter((candidate) => candidate !== explicitUrl)]
    : candidates;
  let last: FetchNewsHtmlResult | null = null;

  for (const url of urls) {
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
      last = { status: 'error', url, error: (error as Error).message };
      continue;
    }

    if (res.status === 404 || res.status === 410) {
      last = { status: 'missing', url, httpStatus: res.status };
      continue;
    }
    if (!res.ok) {
      last = { status: 'error', url, httpStatus: res.status, error: `HTTP ${res.status}` };
      continue;
    }

    const html = await res.text();

    // Only treat as soft-404 when the <title> explicitly says the page wasn't found.
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch?.[1] ?? '';
    if (/\b(?:page not found|404|not found)\b/i.test(title)) {
      last = { status: 'missing', url, httpStatus: 200 };
      continue;
    }

    return { status: 'ok', url, html };
  }

  return last ?? { status: 'missing', url: explicitUrl ?? candidates[0] };
}

/**
 * Strips InsightsOnIndia HTML down to the article body to keep DeepSeek token usage bounded.
 * Tries multiple strategies to locate the main article container, falling back to a body slice.
 */
export function extractInsightsArticleText(html: string, maxChars = 180_000): string {
  if (!html) return '';

  const fragment = extractArticleFragment(html);

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

function extractArticleFragment(html: string): string {
  // Strategy 1: <article> tag — WordPress standard
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article?.[1] && article[1].length > 800) return article[1];

  // Strategy 2: Content divs (WordPress themes: td-composer, Newspaper, default WP)
  const contentClasses = [
    'td-post-content',
    'tdb_single_content',
    'entry-content',
    'post-content',
    'the-content',
    'content-area',
  ];
  for (const cls of contentClasses) {
    const div = html.match(new RegExp(
      `<div[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/(?:section|div|article|main)>`,
      'i',
    ));
    if (div?.[1] && div[1].length > 800) return div[1];
  }

  // Strategy 3: Looser closing — capture until next <footer>, <aside>, </article>, or end of body
  for (const cls of contentClasses) {
    const div = html.match(new RegExp(
      `<div[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)(?:<footer|<aside|<\\/article|<\\/body|$)`,
      'i',
    ));
    if (div?.[1] && div[1].length > 800) return div[1];
  }

  // Strategy 4: Grab body content between header/nav and footer
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = body?.[1] ?? html;
  const betweenHeaderFooter = bodyText.match(
    /(?:<\/header>|<\/nav>)([\s\S]*?)(?:<footer|<\/body>|$)/i,
  );
  if (betweenHeaderFooter?.[1] && betweenHeaderFooter[1].length > 800) return betweenHeaderFooter[1];

  // Strategy 5: Crude fallback — skip first 2000 chars (head, nav, sidebar) and take the rest
  const tail = bodyText.slice(Math.min(2000, bodyText.length));
  if (tail.length > 800) return tail;

  return html;
}
