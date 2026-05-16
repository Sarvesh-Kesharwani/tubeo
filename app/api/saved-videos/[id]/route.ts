import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import {
  getCookieSavedVideos,
  hydrateSavedVideosFromDriveIfNeeded,
  persistSavedVideos,
} from '@/lib/saved-videos';
import { normalizeSavedVideoCategory } from '@/lib/saved-videos-shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { id } = await params;
  const cleanId = id.trim();
  if (!cleanId) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

  let body: { note?: string; category?: string };
  try {
    body = (await req.json()) as { note?: string; category?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const hasNote = Object.hasOwn(body, 'note');
  const hasCategory = Object.hasOwn(body, 'category');
  if (!hasNote && !hasCategory) {
    return Response.json({ ok: false, error: 'Nothing to update' }, { status: 400 });
  }
  const note = String(body.note ?? '').trim();
  const category = normalizeSavedVideoCategory(body.category);

  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session);

  const current = await getCookieSavedVideos();
  if (!current.some((video) => video.id === cleanId)) {
    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  const next = current.map((video) =>
    video.id === cleanId
      ? {
          ...video,
          ...(hasNote ? { note } : {}),
          ...(hasCategory ? { category } : {}),
        }
      : video,
  );

  const result = await persistSavedVideos(next, session);
  revalidatePath('/videos');
  return Response.json({ ok: true, savedVideo: next.find((video) => video.id === cleanId), synced: result.synced, updatedAt: result.updatedAt });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  const cleanId = id.trim();
  if (!cleanId) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });

  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session);

  const current = await getCookieSavedVideos();
  const next = current.filter((video) => video.id !== cleanId);

  const result = await persistSavedVideos(next, session);
  revalidatePath('/videos');
  return Response.json({ ok: true, synced: result.synced, updatedAt: result.updatedAt });
}
