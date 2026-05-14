import { getCookieChannelStore } from '@/lib/channels-cookie';
import { searchYouTubeChannels, type ChannelSearchOrder, type ChannelSearchSafeSearch, type ChannelSearchType } from '@/lib/youtube';

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();

  if (!q) {
    return Response.json({ ok: true, channels: [], ignoredChannels: [], hiddenIgnored: 0 });
  }

  const store = await getCookieChannelStore();
  const ignoredIds = store.ignoredChannels.map((channel) => channel.id);
  const existingIds = store.channels.map((channel) => channel.id);

  try {
    const result = await searchYouTubeChannels({
      q,
      order: pick<ChannelSearchOrder>(
        url.searchParams.get('order'),
        ['date', 'rating', 'relevance', 'title', 'videoCount', 'viewCount'],
        'relevance',
      ),
      regionCode: url.searchParams.get('regionCode') ?? undefined,
      relevanceLanguage: url.searchParams.get('relevanceLanguage') ?? undefined,
      safeSearch: pick<ChannelSearchSafeSearch>(
        url.searchParams.get('safeSearch'),
        ['moderate', 'none', 'strict'],
        'moderate',
      ),
      channelType: pick<ChannelSearchType>(
        url.searchParams.get('channelType'),
        ['any', 'show'],
        'any',
      ),
      publishedAfter: url.searchParams.get('publishedAfter') ?? undefined,
      publishedBefore: url.searchParams.get('publishedBefore') ?? undefined,
      topicId: url.searchParams.get('topicId') ?? undefined,
      pageToken: url.searchParams.get('pageToken') ?? undefined,
      ignoredIds,
    });

    return Response.json({
      ok: true,
      ...result,
      existingIds,
      ignoredChannels: store.ignoredChannels,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || 'Channel search failed.' },
      { status: 500 },
    );
  }
}
