import { NextResponse } from 'next/server';
import { processDailyNewsYouLearnVideo } from '@/lib/news-youlearn-service';
import { getSession } from '@/lib/session';
import { istDateString } from '@/lib/news-source';

export const runtime = 'nodejs';

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail('Sign in to process YouLearn video.', 401);

  let body: { date?: unknown; force?: unknown; videoId?: unknown; videos?: unknown; noteKind?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('Invalid JSON body.');
  }

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : istDateString();
  const videoId = typeof body.videoId === 'string' && body.videoId.trim() ? body.videoId.trim() : undefined;
  const noteKind = body.noteKind === 'analogy' ? 'analogy' : 'layered';

  try {
    const result = await processDailyNewsYouLearnVideo(session, date, {
      force: Boolean(body.force),
      videoId,
      fallbackVideos: Array.isArray(body.videos) ? body.videos : undefined,
      noteKind,
    });
    return NextResponse.json({ ok: true, state: result.state, summary: result.summary });
  } catch (error) {
    return fail((error as Error).message || 'Could not process YouLearn transcript.', 502);
  }
}
