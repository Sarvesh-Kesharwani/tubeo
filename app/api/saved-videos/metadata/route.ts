import { getSession } from '@/lib/session';
import { getVideosByIds } from '@/lib/youtube';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'Sign in required.' }, { status: 401 });
  }

  const ids = new URL(req.url).searchParams
    .get('ids')
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 50) ?? [];

  if (ids.length === 0) {
    return Response.json({ ok: true, videos: [] });
  }

  try {
    const videos = await getVideosByIds(ids);
    return Response.json({ ok: true, videos });
  } catch {
    return Response.json({ ok: true, videos: [] });
  }
}
