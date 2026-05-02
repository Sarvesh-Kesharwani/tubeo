import { EmptyState } from '@/components/EmptyState';
import { SavedVideosClient } from '@/components/SavedVideosClient';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import { getSavedVideoKind, type Video } from '@/lib/types';
import { getVideosByIds } from '@/lib/youtube';

function fallbackYouTubeVideo(id: string): Video {
  return {
    id,
    title: `YouTube video ${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: new Date(0).toISOString(),
    channelId: '',
    channelTitle: 'YouTube',
  };
}

export default async function VideosPage() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <EmptyState
        emoji="TV"
        title="Sign in to view saved videos"
        description="Your watch-later list syncs with the rest of Tubeo."
      />
    );
  }

  const store = await getCookieChannelStore();
  const ytIds = store.savedVideos.filter((video) => getSavedVideoKind(video) === 'youtube').map((video) => video.id);
  let videos: Video[] = [];
  try {
    videos = await getVideosByIds(ytIds);
  } catch {
    videos = [];
  }
  const fetchedIds = new Set(videos.map((video) => video.id));
  const videosWithFallbacks = [...videos, ...ytIds.filter((id) => !fetchedIds.has(id)).map(fallbackYouTubeVideo)];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink">Videos</h1>
      </section>
      <SavedVideosClient savedVideos={store.savedVideos} videos={videosWithFallbacks} now={getRequestTime()} />
    </div>
  );
}
