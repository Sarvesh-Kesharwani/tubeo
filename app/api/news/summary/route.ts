import { loadNewsForUser, loadNewsFromUrl, readNewsForUser } from '@/lib/news-service';
import { parseIstDateString } from '@/lib/news-source';
import { getSession } from '@/lib/session';
import { deleteNewsSummary } from '@/lib/supabase-news';
import { getTubeoUserIdentity } from '@/lib/supabase-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function dateParam(req: Request): string | undefined {
  const value = new URL(req.url).searchParams.get('date');
  if (!value) return undefined;
  return parseIstDateString(value) ? value : undefined;
}

function urlParam(req: Request): string | undefined {
  const value = new URL(req.url).searchParams.get('url');
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) return fail('Not authenticated', 401);

  const result = await readNewsForUser(identity, { date: dateParam(req) });
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) return fail('Not authenticated', 401);

  const manualUrl = urlParam(req);
  if (manualUrl) {
    const result = await loadNewsFromUrl(identity, manualUrl);
    return Response.json({ ok: true, ...result });
  }

  const result = await loadNewsForUser(identity, { date: dateParam(req), forceRegenerate: true });
  return Response.json({ ok: true, ...result });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) return fail('Not authenticated', 401);

  const date = dateParam(req);
  if (!date) return fail('Valid date is required');

  try {
    await deleteNewsSummary(identity, date);
    const result = await readNewsForUser(identity, { date });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return fail((error as Error).message, 502);
  }
}
