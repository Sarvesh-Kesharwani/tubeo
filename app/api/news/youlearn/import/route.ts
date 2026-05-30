import { NextResponse } from 'next/server';
import { importNewsYouLearnSpace } from '@/lib/news-youlearn-service';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail('Sign in to import YouLearn videos.', 401);

  let body: { sourceUrl?: unknown; target?: unknown };
  try {
    body = (await req.json()) as { sourceUrl?: unknown };
  } catch {
    return fail('Invalid JSON body.');
  }

  if (typeof body.sourceUrl !== 'string' || !body.sourceUrl.trim()) {
    return fail('Paste a YouLearn space, YouTube video, or YouTube playlist link.');
  }

  try {
    const target = body.target === 'clipwise' ? 'clipwise' : 'youlearn';
    const state = await importNewsYouLearnSpace(session, body.sourceUrl, target);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return fail((error as Error).message || 'Could not import videos.', 502);
  }
}
