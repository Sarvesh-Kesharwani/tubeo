import { recordApiUsage } from '@/lib/api-usage';
import { getYouTubeChannelStats } from '@/lib/youtube';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const stats = await getYouTubeChannelStats(id);
    if (!stats) {
      return Response.json({ ok: false, error: 'Channel not found.' }, { status: 404 });
    }
    await recordApiUsage('youtube', `Discover stats: ${id}`, stats.quotaUnits);

    return Response.json({ ok: true, ...stats });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || 'Stats fetch failed.' },
      { status: 500 },
    );
  }
}
