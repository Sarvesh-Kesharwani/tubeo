import { recordApiUsage } from '@/lib/api-usage';
import { getTopVideosForChannel } from '@/lib/youtube';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? 3);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, Math.floor(limitRaw))) : 3;

  try {
    const result = await getTopVideosForChannel(id, limit);
    await recordApiUsage('youtube', `Discover Top ${limit} videos: ${id}`, result.quotaUnits);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || 'Top videos fetch failed.' },
      { status: 500 },
    );
  }
}
