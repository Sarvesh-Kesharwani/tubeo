import { EmptyState } from '@/components/EmptyState';
import { SavedVideosClient } from '@/components/SavedVideosClient';
import { getCookieChannelStore } from '@/lib/channels-cookie';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
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
  const videos = await getVideosByIds(store.savedVideos.map((video) => video.id));

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-extrabold text-duo-ink">Videos</h1>
      </section>
      <SavedVideosClient savedVideos={store.savedVideos} videos={videos} now={getRequestTime()} />
    </div>
  );
}
