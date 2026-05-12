import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import {
  getCookieSavedVideos,
  hydrateSavedVideosFromDriveIfNeeded,
  persistSavedVideos,
  reconcileSavedVideos,
  resolveSavedVideoFromUrl,
  type SavedVideo,
} from '@/lib/saved-videos';

export async function GET() {
  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session?.accessToken);
  const videos = await getCookieSavedVideos();
  return Response.json({ ok: true, videos });
}

export async function POST(req: Request) {
  let body: { url?: string; note?: string };
  try {
    body = (await req.json()) as { url?: string; note?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const rawUrl = String(body.url ?? '').trim();
  const note = String(body.note ?? '').trim();
  if (!rawUrl) return Response.json({ ok: false, error: 'Enter a URL.' }, { status: 400 });

  const resolved = resolveSavedVideoFromUrl(rawUrl);
  if (!resolved) return Response.json({ ok: false, error: 'Enter a valid URL.' }, { status: 400 });

  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session?.accessToken);

  const current = await getCookieSavedVideos();
  const existingOthers = current.filter((video) => video.id !== resolved.id);
  const savedVideo: SavedVideo = {
    id: resolved.id,
    url: resolved.url,
    note,
    addedAt: new Date().toISOString(),
  };
  const next = [savedVideo, ...existingOthers];

  const result = await persistSavedVideos(next, session?.accessToken);
  revalidatePath('/videos');
  return Response.json({ ok: true, savedVideo, synced: result.synced, updatedAt: result.updatedAt });
}

// Manual sync (push from cookie + pull from drive, merge, write back)
export async function PUT() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  const result = await reconcileSavedVideos(session.accessToken);
  revalidatePath('/videos');
  return Response.json({ ok: true, videos: result.videos, synced: result.synced, updatedAt: result.updatedAt });
}
