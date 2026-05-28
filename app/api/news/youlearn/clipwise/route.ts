import { NextResponse } from 'next/server';
import { saveNewsYouLearnClipWiseProgress } from '@/lib/news-youlearn-service';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail('Sign in to sync ClipWise progress.', 401);

  let body: {
    videoId?: unknown;
    clipSeconds?: unknown;
    done?: unknown;
    lastClipIndex?: unknown;
    completedAt?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('Invalid JSON body.');
  }

  if (typeof body.videoId !== 'string' || !body.videoId.trim()) {
    return fail('Choose a video to sync ClipWise progress.');
  }

  try {
    const result = await saveNewsYouLearnClipWiseProgress(session, {
      videoId: body.videoId.trim(),
      clipSeconds:
        typeof body.clipSeconds === 'number' && Number.isFinite(body.clipSeconds)
          ? body.clipSeconds
          : 120,
      done: Array.isArray(body.done) ? body.done : [],
      lastClipIndex:
        typeof body.lastClipIndex === 'number' && Number.isFinite(body.lastClipIndex)
          ? body.lastClipIndex
          : 0,
      completedAt:
        typeof body.completedAt === 'string' && body.completedAt.trim()
          ? body.completedAt
          : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return fail((error as Error).message || 'Could not sync ClipWise progress.', 502);
  }
}
