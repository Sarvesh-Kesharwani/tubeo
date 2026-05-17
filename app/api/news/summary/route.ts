import { loadNewsForUser } from '@/lib/news-service';
import { parseIstDateString } from '@/lib/news-source';
import { getSession } from '@/lib/session';
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

export async function GET(req: Request) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) return fail('Not authenticated', 401);

  const result = await loadNewsForUser(identity, { date: dateParam(req) });
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) return fail('Not authenticated', 401);

  const result = await loadNewsForUser(identity, { date: dateParam(req), forceRegenerate: true });
  return Response.json({ ok: true, ...result });
}
