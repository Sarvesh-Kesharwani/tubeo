import { revalidatePath } from 'next/cache';
import { istDateString } from '@/lib/news-source';
import { getSession } from '@/lib/session';
import { clearYtCacheForDate, isSupabaseYtCacheConfigured } from '@/lib/supabase-yt-cache';
import { clearMemoryYtCacheForDate } from '@/lib/youtube-api-cache';

export const dynamic = 'force-dynamic';

const ALLOWED_PATHS = new Set(['/', '/channels', '/updates', '/news']);

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail('Not authenticated', 401);

  let body: { paths?: unknown };
  try {
    body = (await req.json()) as { paths?: unknown };
  } catch {
    body = {};
  }

  const requestedPaths = Array.isArray(body.paths)
    ? Array.from(
        new Set(
          body.paths
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim())
            .filter((value) => ALLOWED_PATHS.has(value)),
        ),
      )
    : [];

  const today = istDateString();
  let deletedRows: number | null = null;
  let error: string | null = null;

  if (isSupabaseYtCacheConfigured()) {
    try {
      deletedRows = await clearYtCacheForDate(today);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  // Drop any in-process memory rows so the next request re-reads from Supabase.
  clearMemoryYtCacheForDate(today);

  for (const p of requestedPaths) {
    try {
      revalidatePath(p);
    } catch {
      // Best-effort: a stray path failure shouldn't break the response.
    }
  }

  return Response.json({
    ok: error === null,
    date: today,
    deletedRows,
    revalidated: requestedPaths,
    supabaseConfigured: isSupabaseYtCacheConfigured(),
    ...(error ? { error } : {}),
  });
}
