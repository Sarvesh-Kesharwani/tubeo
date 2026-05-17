import {
  extractInsightsArticleText,
  fetchInsightsOnIndiaHtml,
  insightsOnIndiaUrl,
  istDateString,
} from '@/lib/news-source';
import { isSupabaseNewsConfigured, readNewsRaw, writeNewsRaw } from '@/lib/supabase-news';

export const dynamic = 'force-dynamic';

/**
 * Cron entry point. Fetches today's InsightsOnIndia UPSC current-affairs page
 * and caches the raw HTML in Supabase. Idempotent — re-runs the same day will
 * skip the network call if a non-empty cached row already exists.
 *
 * Schedule: 00:00, 18:00, 21:00 IST (see vercel.json).
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!expected || auth !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseNewsConfigured()) {
    return Response.json(
      { ok: false, error: 'Supabase news cache is not configured (env vars missing).' },
      { status: 503 },
    );
  }

  // Allow an override for ops debugging: /api/cron/fetch-news?date=YYYY-MM-DD
  const url = new URL(req.url);
  const explicitDate = url.searchParams.get('date');
  const date = explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate) ? explicitDate : istDateString();
  const force = url.searchParams.get('force') === '1';

  // Skip if we already have a healthy cached copy and not forced.
  if (!force) {
    try {
      const cached = await readNewsRaw(date);
      if (cached && cached.html.length > 2000 && extractInsightsArticleText(cached.html).length > 500) {
        return Response.json({
          ok: true,
          date,
          url: cached.url,
          cached: true,
          fetchedAt: cached.fetchedAt,
        });
      }
    } catch (error) {
      // Continue to refetch if the read failed.
      console.error('news cron: cached read failed', error);
    }
  }

  const result = await fetchInsightsOnIndiaHtml(date);
  if (result.status === 'missing') {
    return Response.json({ ok: true, date, url: result.url, cached: false, status: 'missing' });
  }
  if (result.status === 'error' || !result.html) {
    return Response.json(
      {
        ok: false,
        date,
        url: result.url,
        cached: false,
        status: 'error',
        httpStatus: result.httpStatus,
        error: result.error,
      },
      { status: result.httpStatus && result.httpStatus < 500 ? result.httpStatus : 502 },
    );
  }

  try {
    await writeNewsRaw({
      date,
      url: result.url || insightsOnIndiaUrl(date),
      html: result.html,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      { ok: false, date, url: result.url, status: 'write-failed', error: (error as Error).message },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    date,
    url: result.url,
    cached: false,
    bytes: result.html.length,
  });
}
