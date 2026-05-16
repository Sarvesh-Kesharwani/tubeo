import {
  DeepSeekConfigError,
  DeepSeekRequestError,
  searchSavedVideosByNote,
} from '@/lib/deepseek';
import {
  getCookieSavedVideos,
  hydrateSavedVideosFromDriveIfNeeded,
} from '@/lib/saved-videos';
import { getSession } from '@/lib/session';
import type { SavedVideo } from '@/lib/saved-videos-shared';

interface SearchBody {
  query?: unknown;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'Sign in required.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as SearchBody | null;
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return Response.json({ ok: false, error: 'Ask what you want to find.' }, { status: 400 });
  }

  await hydrateSavedVideosFromDriveIfNeeded(session);
  const saved = await getCookieSavedVideos();
  const eligible = saved.filter((video) => video.note.trim());
  if (eligible.length === 0) {
    return Response.json({ ok: true, results: [] });
  }

  try {
    const matches = await searchSavedVideosByNote(
      query,
      eligible.map((video) => ({
        id: video.id,
        note: video.note,
      })),
    );
    const videoById = new Map<string, SavedVideo>(saved.map((video) => [video.id, video]));
    const results = matches
      .map((match) => {
        const video = videoById.get(match.id);
        if (!video) return null;
        return {
          video,
          confidence: match.confidence,
          reason: match.reason,
        };
      })
      .filter((item): item is { video: SavedVideo; confidence: number; reason: string } => Boolean(item));

    return Response.json({ ok: true, results });
  } catch (error) {
    if (error instanceof DeepSeekConfigError) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (error instanceof DeepSeekRequestError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error('Saved video note search failed', error);
    return Response.json({ ok: false, error: 'Failed to search saved videos.' }, { status: 500 });
  }
}
