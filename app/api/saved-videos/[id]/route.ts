import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import {
  getCookieSavedVideos,
  hydrateSavedVideosFromDriveIfNeeded,
  persistSavedVideos,
} from '@/lib/saved-videos';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const cleanId = id.trim();
  if (!cleanId) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

  let body: { note?: string };
  try {
    body = (await req.json()) as { note?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const note = String(body.note ?? '').trim();

  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session?.accessToken);

  const current = await getCookieSavedVideos();
  if (!current.some((video) => video.id === cleanId)) {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  const next = current.map((video) => (video.id === cleanId ? { ...video, note } : video));

  const result = await persistSavedVideos(next, session?.accessToken);
  revalidatePath('/videos');
  return Response.json({ ok: true, synced: result.synced, updatedAt: result.updatedAt });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const cleanId = id.trim();
  if (!cleanId) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session?.accessToken);

  const current = await getCookieSavedVideos();
  const next = current.filter((video) => video.id !== cleanId);

  const result = await persistSavedVideos(next, session?.accessToken);
  revalidatePath('/videos');
  return Response.json({ ok: true, synced: result.synced, updatedAt: result.updatedAt });
}
