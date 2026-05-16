import { recordApiUsage } from '@/lib/api-usage';
import { searchYouTubeShorts } from '@/lib/youtube';

function dayBoundaryIso(date: string, end: boolean): string | undefined {
  if (!date) return undefined;
  const stamp = end ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
  const parsed = Date.parse(stamp);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) {
    return Response.json({ ok: false, error: 'Keywords are required.' }, { status: 400 });
  }

  const after = url.searchParams.get('publishedAfter')?.trim() || '';
  const before = url.searchParams.get('publishedBefore')?.trim() || '';
  const maxRaw = Number(url.searchParams.get('limit') ?? 50);
  const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(50, Math.floor(maxRaw))) : 50;
  const orderParam = url.searchParams.get('order');
  const order =
    orderParam === 'date' || orderParam === 'viewCount' || orderParam === 'relevance' || orderParam === 'rating'
      ? orderParam
      : undefined;

  try {
    const result = await searchYouTubeShorts({
      q,
      publishedAfter: dayBoundaryIso(after, false),
      publishedBefore: dayBoundaryIso(before, true),
      maxResults: max,
      order,
    });
    await recordApiUsage('youtube', `Short feed: ${q}`, result.quotaUnits);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || 'Short feed fetch failed.' },
      { status: 500 },
    );
  }
}
