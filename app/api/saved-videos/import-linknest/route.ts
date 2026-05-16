import { revalidatePath } from 'next/cache';
import { fetchLinkNestSavedLinks, importLinkNestRows } from '@/lib/linknest-import';
import { getSession } from '@/lib/session';
import {
  getCookieSavedVideos,
  hydrateSavedVideosFromDriveIfNeeded,
  persistSavedVideos,
} from '@/lib/saved-videos';

export async function POST() {
  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session);

  try {
    const [current, rows] = await Promise.all([
      getCookieSavedVideos(),
      fetchLinkNestSavedLinks(),
    ]);
    const result = importLinkNestRows(current, rows);

    if (result.imported.length === 0 && result.updated === 0) {
      return Response.json({
        ok: true,
        imported: 0,
        skipped: result.skipped,
        updated: 0,
        total: result.total,
        videos: current,
      });
    }

    const persisted = await persistSavedVideos(result.videos, session);
    revalidatePath('/videos');
    return Response.json({
      ok: true,
      imported: result.imported.length,
      skipped: result.skipped,
      updated: result.updated,
      total: result.total,
      videos: result.videos,
      synced: persisted.synced,
      updatedAt: persisted.updatedAt,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to import LinkNest videos.',
      },
      { status: 500 },
    );
  }
}
