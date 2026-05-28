import { NextResponse } from 'next/server';
import {
  clearNewsYouLearnVideos,
  markNewsYouLearnVideoCompleted,
  removeNewsYouLearnVideo,
} from '@/lib/news-youlearn-service';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail('Sign in to edit YouLearn videos.', 401);

  let body: { videoId?: unknown; clear?: unknown };
  try {
    body = (await req.json()) as { videoId?: unknown; clear?: unknown };
  } catch {
    return fail('Invalid JSON body.');
  }

  try {
    const state =
      body.clear === true
        ? await clearNewsYouLearnVideos(session)
        : typeof body.videoId === 'string' && body.videoId.trim()
          ? await removeNewsYouLearnVideo(session, body.videoId.trim())
          : null;

    if (!state) return fail('Choose a video to remove or clear the list.');
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return fail((error as Error).message || 'Could not update YouLearn list.', 502);
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail('Sign in to edit YouLearn videos.', 401);

  let body: { videoId?: unknown; completed?: unknown };
  try {
    body = (await req.json()) as { videoId?: unknown; completed?: unknown };
  } catch {
    return fail('Invalid JSON body.');
  }

  if (body.completed !== true || typeof body.videoId !== 'string' || !body.videoId.trim()) {
    return fail('Choose a video to mark completed.');
  }

  try {
    const state = await markNewsYouLearnVideoCompleted(session, body.videoId.trim());
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return fail((error as Error).message || 'Could not mark YouLearn video completed.', 502);
  }
}
