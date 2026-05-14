import { EmptyState } from '@/components/EmptyState';
import { WatchListClient } from '@/components/WatchListClient';
import {
  getCookieSavedVideos,
  getSavedVideoKind,
  hydrateSavedVideosFromDriveIfNeeded,
  persistSavedVideos,
} from '@/lib/saved-videos';
import { readInstagramInboxSavedVideos } from '@/lib/instagram';
import { fetchLinkNestSavedLinks, importLinkNestRows } from '@/lib/linknest-import';
import { getRequestTime } from '@/lib/render';
import { getSession } from '@/lib/session';
import { getVideosByIds } from '@/lib/youtube';
import type { Video } from '@/lib/types';

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

  await hydrateSavedVideosFromDriveIfNeeded(session.accessToken);
  const [cookieSaved, inboxSaved] = await Promise.all([
    getCookieSavedVideos(),
    readInstagramInboxSavedVideos(),
  ]);
  let saved = cookieSaved;
  try {
    const rows = await fetchLinkNestSavedLinks();
    const imported = importLinkNestRows(saved, rows);
    if (imported.imported.length > 0 || imported.updated > 0) {
      saved = imported.videos;
      await persistSavedVideos(saved, session.accessToken);
    }
  } catch {
    // Keep the page usable if LinkNest is temporarily unavailable.
  }

  const existingIds = new Set(saved.map((video) => video.id));
  const newInboxSaved = inboxSaved.filter((video) => !existingIds.has(video.id));
  saved = newInboxSaved.length > 0 ? [...newInboxSaved, ...saved] : saved;

  if (newInboxSaved.length > 0) {
    await persistSavedVideos(saved, session.accessToken);
  }

  const ytIds = saved.filter((video) => getSavedVideoKind(video) === 'youtube').map((video) => video.id);
  let videos: Video[] = [];
  try {
    videos = await getVideosByIds(ytIds);
  } catch {
    videos = [];
  }
  const fetched = new Set(videos.map((video) => video.id));
  const videosWithFallbacks = [...videos, ...ytIds.filter((id) => !fetched.has(id)).map(fallbackYouTubeVideo)];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-duo-ink">Videos</h1>
      </section>
      <WatchListClient initialSaved={saved} videos={videosWithFallbacks} now={getRequestTime()} />
    </div>
  );
}
