import { revalidatePath } from 'next/cache';
import { categorizeSavedVideos, DeepSeekConfigError, DeepSeekRequestError } from '@/lib/deepseek';
import { getSession } from '@/lib/session';
import {
  getCookieSavedVideos,
  hydrateSavedVideosFromDriveIfNeeded,
  isUncategorizedSavedVideo,
  persistSavedVideos,
} from '@/lib/saved-videos';
import { normalizeSavedVideoCategory } from '@/lib/saved-videos-shared';

export async function POST() {
  const session = await getSession();
  await hydrateSavedVideosFromDriveIfNeeded(session?.accessToken);

  const current = await getCookieSavedVideos();
  const eligible = current.filter((video) => isUncategorizedSavedVideo(video) && video.note.trim());
  if (eligible.length === 0) {
    return Response.json({ ok: true, categorized: 0, skipped: current.length, videos: current });
  }

  try {
    const categories = await categorizeSavedVideos(
      eligible.map((video) => ({
        id: video.id,
        url: video.url,
        note: video.note,
      })),
    );
    const categoryById = new Map(categories.map((item) => [item.id, normalizeSavedVideoCategory(item.category)]));
    const next = current.map((video) => {
      const category = categoryById.get(video.id);
      return category ? { ...video, category } : video;
    });
    const changed = next.filter((video, index) => video.category !== current[index]?.category).length;
    const result = await persistSavedVideos(next, session?.accessToken);
    revalidatePath('/videos');
    return Response.json({
      ok: true,
      categorized: changed,
      skipped: current.length - eligible.length,
      videos: next,
      synced: result.synced,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    if (error instanceof DeepSeekConfigError) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (error instanceof DeepSeekRequestError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json({ ok: false, error: 'Failed to categorize saved videos.' }, { status: 500 });
  }
}
