import {
  getCookieSavedVideos,
  hydrateSavedVideosFromDriveIfNeeded,
  persistSavedVideos,
} from '@/lib/saved-videos';
import { readInstagramInboxSavedVideos } from '@/lib/instagram';
import { fetchLinkNestSavedLinks, importLinkNestRows } from '@/lib/linknest-import';
import { getSession } from '@/lib/session';

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'Sign in required.' }, { status: 401 });
  }

  await withTimeout(hydrateSavedVideosFromDriveIfNeeded(session), 3000, undefined);

  let saved = await getCookieSavedVideos();
  const [inboxSaved, linkNestRows] = await Promise.all([
    withTimeout(readInstagramInboxSavedVideos(), 5000, []),
    withTimeout(fetchLinkNestSavedLinks(), 5000, []),
  ]);

  const imported = importLinkNestRows(saved, linkNestRows);
  saved = imported.videos;

  const existingIds = new Set(saved.map((video) => video.id));
  const newInboxSaved = inboxSaved.filter((video) => !existingIds.has(video.id));
  saved = newInboxSaved.length > 0 ? [...newInboxSaved, ...saved] : saved;

  if (newInboxSaved.length > 0 || imported.imported.length > 0 || imported.updated > 0) {
    await persistSavedVideos(saved, session);
  }

  return Response.json({
    ok: true,
    videos: saved,
    imported: imported.imported.length + newInboxSaved.length,
    updated: imported.updated,
    skipped: imported.skipped,
  });
}
