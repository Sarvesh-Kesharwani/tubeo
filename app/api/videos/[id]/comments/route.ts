import { recordApiUsage } from '@/lib/api-usage';
import { getVideoCommentsWithQuota } from '@/lib/youtube';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return Response.json({ ok: false, error: 'Video ID missing' }, { status: 400 });
  }

  try {
    const result = await getVideoCommentsWithQuota(id);
    const { quotaUnits, ...comments } = result;
    await recordApiUsage('youtube', `Video comments panel: ${id}`, quotaUnits);
    return Response.json({ ok: true, comments, quotaUnits });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || 'Could not load comments' },
      { status: 500 },
    );
  }
}
