import { EmptyState } from '@/components/EmptyState';
import { SavedVideosClient } from '@/components/SavedVideosClient';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import { getSavedVideoKind } from '@/lib/types';
import { getVideosByIds } from '@/lib/youtube';

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
  const videos = await getVideosByIds(ytIds);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold text-duo-ink">Videos</h1>
      </section>
      <SavedVideosClient savedVideos={store.savedVideos} videos={videos} now={getRequestTime()} />
    </div>
  );
}
