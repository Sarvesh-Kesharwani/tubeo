'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoCard } from '@/components/VideoCard';
import { VideoPlayerModal } from '@/components/VideoPlayerModal';
import { ShortFeedDialog } from '@/components/ShortFeedDialog';
import type { Video } from '@/lib/types';
import {
  INSTAGRAM_SAVED_PREFIX,
  UNCATEGORIZED_SAVED_CATEGORY,
  getSavedVideoKind,
  normalizeSavedVideoCategory,
  type SavedVideo,
} from '@/lib/saved-videos-shared';

const BASE_CATEGORIES = [UNCATEGORIZED_SAVED_CATEGORY, 'Watch Later'];
const EXTENSION_SHORTCUT_KEYS = new Set(['a', 's', 'd']);

interface ChatResult {
  video: SavedVideo;
  confidence: number;
  reason?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  results?: ChatResult[];
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function mergeById(current: SavedVideo[], incoming: SavedVideo[]): SavedVideo[] {
  const seen = new Set<string>();
  const out: SavedVideo[] = [];
  for (const video of [...incoming, ...current]) {
    if (!video.id || seen.has(video.id)) continue;
    seen.add(video.id);
    out.push({
      ...video,
      category: normalizeSavedVideoCategory(video.category),
    });
  }
  return out;
}

function savedKey(videos: SavedVideo[]): string {
  return videos
    .map((video) => `${video.id}:${video.note}:${normalizeSavedVideoCategory(video.category)}`)
    .join('|');
}

function mergeVideoDetails(current: Video[], incoming: Video[]): Video[] {
  const byId = new Map(current.map((video) => [video.id, video]));
  for (const video of incoming) byId.set(video.id, video);
  return [...byId.values()];
}

function getInstagramEmbedSrc(saved: SavedVideo, autoplay = false): string | null {
  if (getSavedVideoKind(saved) !== 'instagram') return null;
  const type = saved.url.includes('/reel/') ? 'reel' : 'p';
  const src = `https://www.instagram.com/${type}/${saved.id.slice(INSTAGRAM_SAVED_PREFIX.length)}/embed/`;
  return autoplay ? `${src}?autoplay=1&muted=1` : src;
}

function getYouTubeEmbedSrc(id: string, autoplay = false): string {
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
  });
  if (autoplay) {
    params.set('autoplay', '1');
    params.set('mute', '1');
  }
  return `https://www.youtube.com/embed/${id}?${params}`;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}

function stopExtensionShortcut(event: KeyboardEvent | React.KeyboardEvent<HTMLElement>) {
  const key = event.key.toLowerCase();
  if (!EXTENSION_SHORTCUT_KEYS.has(key)) return;

  event.stopPropagation();
  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event;
  nativeEvent.stopImmediatePropagation?.();
}

export function WatchListClient({
  initialSaved,
  videos,
  now,
}: {
  initialSaved: SavedVideo[];
  videos: Video[];
  now: number;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(() =>
    initialSaved.map((video) => ({
      ...video,
      category: normalizeSavedVideoCategory(video.category),
    })),
  );
  const [videoDetails, setVideoDetails] = useState(videos);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialSaved.map((video) => [video.id, video.note])),
  );
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [shortFeedOpen, setShortFeedOpen] = useState(false);
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [categorizePending, setCategorizePending] = useState(false);
  const [linkNestPending, setLinkNestPending] = useState(false);
  const [linkNestDeleteId, setLinkNestDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatQuery, setChatQuery] = useState('');
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Ask for saved videos by your notes. Matches at 50% confidence or higher appear here.',
    },
  ]);
  const initialKey = useRef(savedKey(initialSaved));
  const didRefreshSources = useRef(false);
  const feedViewportRef = useRef<HTMLDivElement>(null);
  const feedItemRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    setVideoDetails((current) => mergeVideoDetails(current, videos));
  }, [videos]);

  useEffect(() => {
    const key = savedKey(initialSaved);
    if (key === initialKey.current) return;
    initialKey.current = key;
    setSaved((current) => mergeById(current, initialSaved));
    setNoteDrafts((current) => ({
      ...Object.fromEntries(initialSaved.map((video) => [video.id, video.note])),
      ...current,
    }));
  }, [initialSaved]);

  const videoById = useMemo(() => new Map(videoDetails.map((video) => [video.id, video])), [videoDetails]);
  const sorted = useMemo(
    () =>
      [...saved].sort((a, b) => {
        const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        return bTime - aTime;
      }),
    [saved],
  );

  const categories = useMemo(() => {
    const names = new Set<string>(BASE_CATEGORIES);
    for (const video of saved) names.add(normalizeSavedVideoCategory(video.category));
    return [...names].sort((a, b) => {
      if (a === UNCATEGORIZED_SAVED_CATEGORY) return -1;
      if (b === UNCATEGORIZED_SAVED_CATEGORY) return 1;
      return a.localeCompare(b);
    });
  }, [saved]);

  const grouped = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          items: sorted.filter((video) => normalizeSavedVideoCategory(video.category) === category),
        }))
        .filter((group) => group.items.length > 0),
    [categories, sorted],
  );

  const uncategorizedWithNoteCount = saved.filter(
    (video) =>
      normalizeSavedVideoCategory(video.category) === UNCATEGORIZED_SAVED_CATEGORY &&
      video.note.trim(),
  ).length;

  useEffect(() => {
    const missingIds = sorted
      .filter((video) => {
        if (getSavedVideoKind(video) !== 'youtube') return false;
        const details = videoById.get(video.id);
        return !details || details.title === `YouTube video ${video.id}`;
      })
      .map((video) => video.id)
      .slice(0, 50);
    if (missingIds.length === 0) return;

    const controller = new AbortController();
    fetch(`/api/saved-videos/metadata?ids=${encodeURIComponent(missingIds.join(','))}`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data: { videos?: Video[] }) => {
        if (data.videos?.length) {
          setVideoDetails((current) => mergeVideoDetails(current, data.videos ?? []));
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, [sorted, videoById]);

  useEffect(() => {
    if (didRefreshSources.current) return;
    didRefreshSources.current = true;

    const controller = new AbortController();
    fetch('/api/saved-videos/refresh', { method: 'POST', signal: controller.signal })
      .then((response) => response.json())
      .then((data: { videos?: SavedVideo[] }) => {
        if (!data.videos?.length) return;
        const nextVideos = data.videos.map((video) => ({
          ...video,
          category: normalizeSavedVideoCategory(video.category),
        }));
        setSaved((current) => mergeById(current, nextVideos));
        setNoteDrafts((current) => ({
          ...Object.fromEntries(nextVideos.map((video) => [video.id, video.note])),
          ...current,
        }));
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onKeyEvent = (event: KeyboardEvent) => {
      if (!isEditableElement(event.target)) return;
      stopExtensionShortcut(event);
    };

    window.addEventListener('keydown', onKeyEvent, true);
    window.addEventListener('keypress', onKeyEvent, true);
    window.addEventListener('keyup', onKeyEvent, true);
    return () => {
      window.removeEventListener('keydown', onKeyEvent, true);
      window.removeEventListener('keypress', onKeyEvent, true);
      window.removeEventListener('keyup', onKeyEvent, true);
    };
  }, []);

  useEffect(() => {
    if (!feedOpen) {
      setActiveFeedId(null);
      return;
    }

    const firstId = sorted[0]?.id ?? null;
    setActiveFeedId((current) => current ?? firstId);

    const root = feedViewportRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const activeEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const id = activeEntry?.target.getAttribute('data-feed-id');
        if (id) setActiveFeedId(id);
      },
      {
        root,
        threshold: [0.55, 0.7, 0.9],
      },
    );

    for (const item of sorted) {
      const node = feedItemRefs.current[item.id];
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [feedOpen, sorted]);

  async function patchSavedVideo(
    id: string,
    body: { note?: string; category?: string },
  ): Promise<SavedVideo> {
    const response = await fetch(`/api/saved-videos/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      savedVideo?: SavedVideo;
      error?: string;
    } | null;
    if (!response.ok || !data?.ok || !data.savedVideo) {
      throw new Error(data?.error ?? 'Failed to update item.');
    }
    return {
      ...data.savedVideo,
      category: normalizeSavedVideoCategory(data.savedVideo.category),
    };
  }

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const response = await fetch('/api/saved-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, note }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        savedVideo?: SavedVideo;
        synced?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.savedVideo) {
        setError(data?.error ?? 'Failed to save this item.');
        return;
      }
      const savedVideo = {
        ...data.savedVideo,
        category: normalizeSavedVideoCategory(data.savedVideo.category),
      };
      setSaved((current) => [savedVideo, ...current.filter((video) => video.id !== savedVideo.id)]);
      setNoteDrafts((current) => ({ ...current, [savedVideo.id]: savedVideo.note }));
      setUrl('');
      setNote('');
      router.refresh();
    } catch {
      setError('Failed to save this item.');
    } finally {
      setPending(false);
    }
  }

  async function handleSaveNote(id: string) {
    if (busyId) return;
    setError(null);
    setMessage(null);
    setBusyId(id);
    const nextNote = (noteDrafts[id] ?? '').trim();
    try {
      const savedVideo = await patchSavedVideo(id, { note: nextNote });
      setSaved((current) => current.map((video) => (video.id === id ? savedVideo : video)));
      setNoteDrafts((current) => ({ ...current, [id]: savedVideo.note }));
      setMessage('Note saved.');
      router.refresh();
    } catch {
      setError('Failed to save note.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMoveCategory(id: string, category: string) {
    if (busyId) return;
    setError(null);
    setMessage(null);
    setBusyId(id);
    const previous = saved;
    const normalized = normalizeSavedVideoCategory(category);
    setSaved((current) =>
      current.map((video) => (video.id === id ? { ...video, category: normalized } : video)),
    );
    try {
      const savedVideo = await patchSavedVideo(id, { category: normalized });
      setSaved((current) => current.map((video) => (video.id === id ? savedVideo : video)));
      router.refresh();
    } catch {
      setSaved(previous);
      setError('Failed to move item.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCategorize() {
    if (categorizePending || uncategorizedWithNoteCount === 0) return;
    setError(null);
    setMessage(null);
    setCategorizePending(true);
    try {
      const response = await fetch('/api/saved-videos/categorize', { method: 'POST' });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        categorized?: number;
        videos?: SavedVideo[];
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'Failed to categorize saved items.');
        return;
      }
      if (data.videos) {
        setSaved(data.videos.map((video) => ({ ...video, category: normalizeSavedVideoCategory(video.category) })));
      }
      setMessage(`Categorized ${data.categorized ?? 0} item${data.categorized === 1 ? '' : 's'}.`);
      router.refresh();
    } catch {
      setError('Failed to categorize saved items.');
    } finally {
      setCategorizePending(false);
    }
  }

  async function handleImportLinkNest() {
    if (linkNestPending) return;
    setError(null);
    setMessage(null);
    setLinkNestPending(true);
    try {
      const response = await fetch('/api/saved-videos/import-linknest', { method: 'POST' });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        imported?: number;
        skipped?: number;
        updated?: number;
        videos?: SavedVideo[];
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'Failed to import LinkNest videos.');
        return;
      }
      if (data.videos) {
        const nextVideos = data.videos.map((video) => ({
          ...video,
          category: normalizeSavedVideoCategory(video.category),
        }));
        setSaved(nextVideos);
        setNoteDrafts(Object.fromEntries(nextVideos.map((video) => [video.id, video.note])));
      }
      setMessage(`Imported ${data.imported ?? 0} from LinkNest. Updated ${data.updated ?? 0}. Skipped ${data.skipped ?? 0} duplicate${data.skipped === 1 ? '' : 's'}.`);
      router.refresh();
    } catch {
      setError('Failed to import LinkNest videos.');
    } finally {
      setLinkNestPending(false);
    }
  }

  async function handleRemove(id: string) {
    const previous = saved;
    setSaved((current) => current.filter((video) => video.id !== id));
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/saved-videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('delete failed');
      router.refresh();
    } catch {
      setSaved(previous);
      setError('Failed to remove item.');
    }
  }

  async function handleRemoveLinkNest(item: SavedVideo) {
    if (linkNestDeleteId) return;
    setError(null);
    setMessage(null);
    setLinkNestDeleteId(item.id);
    try {
      const response = await fetch('/api/saved-videos/linknest', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkNestId: item.linkNestId, url: item.url }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        deleted?: number;
        archived?: number;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'Failed to remove from LinkNest.');
        return;
      }
      setMessage(
        data.deleted && data.deleted > 0
          ? `Removed ${data.deleted} LinkNest row${data.deleted === 1 ? '' : 's'}.`
          : data.archived && data.archived > 0
            ? `Removed ${data.archived} LinkNest row${data.archived === 1 ? '' : 's'} from import.`
          : 'No matching LinkNest row found.',
      );
    } catch {
      setError('Failed to remove from LinkNest.');
    } finally {
      setLinkNestDeleteId(null);
    }
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = chatQuery.trim();
    if (!query || chatPending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: query,
    };
    setChatMessages((current) => [...current, userMessage]);
    setChatQuery('');
    setChatError(null);
    setChatPending(true);

    try {
      const response = await fetch('/api/saved-videos/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        results?: ChatResult[];
        error?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        const nextError = data?.error ?? 'Failed to search saved videos.';
        setChatError(nextError);
        setChatMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text: nextError,
          },
        ]);
        return;
      }

      const results = data.results ?? [];
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text:
            results.length > 0
              ? `Found ${results.length} saved video${results.length === 1 ? '' : 's'} at 50% confidence or higher.`
              : 'No saved videos crossed 50% confidence from notes.',
          results,
        },
      ]);
    } catch {
      setChatError('Failed to search saved videos.');
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: 'Failed to search saved videos.',
        },
      ]);
    } finally {
      setChatPending(false);
    }
  }

  function handleOpenFeed() {
    setActiveFeedId(sorted[0]?.id ?? null);
    setFeedOpen(true);
  }

  function renderSavedPreview(item: SavedVideo, feed = false, active = false) {
    const video = videoById.get(item.id);
    const kind = getSavedVideoKind(item);
    const igEmbedSrc = getInstagramEmbedSrc(item, feed && active);

    if (kind === 'instagram' && igEmbedSrc) {
      return (
        <>
          <div className={feed ? 'h-full w-full bg-black' : 'aspect-[16/10] w-full bg-black'}>
            <iframe
              key={`${item.id}-${feed && active ? 'active' : 'idle'}`}
              src={igEmbedSrc}
              className="h-full w-full border-0"
              loading={feed && active ? 'eager' : 'lazy'}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              scrolling="no"
              title="Instagram reel"
            />
          </div>
          {!feed && (
            <div className="border-t-2 border-duo-border bg-duo-soft px-2 py-1 text-[11px] font-bold text-duo-mute">
              Instagram -{' '}
              <a href={item.url} target="_blank" rel="noreferrer" className="text-duo-green underline">
                Open
              </a>
            </div>
          )}
        </>
      );
    }

    if (kind === 'youtube' && feed) {
      return (
        <iframe
          key={`${item.id}-${active ? 'active' : 'idle'}`}
          src={getYouTubeEmbedSrc(item.id, active)}
          className="h-full w-full border-0"
          title={video?.title ?? item.url}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      );
    }

    if (kind === 'webpage') {
      return (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="flex flex-1 flex-col gap-1 bg-duo-soft p-3 transition hover:bg-duo-green/10"
        >
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-duo-blueDark border border-duo-border">
            <span aria-hidden>Link</span> Webpage
          </span>
          <span className="text-sm font-extrabold text-duo-ink">{getHostname(item.url)}</span>
          <span className="break-all text-xs font-bold text-duo-mute">{item.url}</span>
        </a>
      );
    }

    if (video) {
      return (
        <div className={feed ? 'h-full w-full [&_.card]:h-full [&_.aspect-video]:h-full' : '[&_.aspect-video]:aspect-[16/10]'}>
          <VideoCard video={video} now={now} onOpen={feed ? undefined : setActiveVideo} showChannel={!feed} showSummary={!feed} />
        </div>
      );
    }

    return (
      <a href={item.url} target="_blank" rel="noreferrer" className="block flex-1 bg-duo-soft p-3 text-sm font-bold">
        {item.url}
      </a>
    );
  }

  function renderSavedCard(item: SavedVideo) {
    const category = normalizeSavedVideoCategory(item.category);
    return (
      <article key={item.id} className="card flex h-full flex-col overflow-hidden">
        <div className="flex flex-1 flex-col">{renderSavedPreview(item)}</div>
        <div className="mt-auto space-y-2 border-t-2 border-duo-border p-2">
          <div className="flex items-center gap-2">
            <span className="chip cursor-default px-2 py-1 text-[10px]">{category}</span>
            <select
              value={category}
              onChange={(event) => void handleMoveCategory(item.id, event.currentTarget.value)}
              disabled={busyId === item.id}
              className="min-w-0 flex-1 rounded-full border-2 border-duo-border bg-white px-2 py-1 text-xs font-bold outline-none focus:border-duo-green"
              aria-label="Move category"
            >
              {categories.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={noteDrafts[item.id] ?? item.note}
            onChange={(event) =>
              setNoteDrafts((current) => ({ ...current, [item.id]: event.currentTarget.value }))
            }
            onKeyDownCapture={stopExtensionShortcut}
            onKeyPressCapture={stopExtensionShortcut}
            onKeyUpCapture={stopExtensionShortcut}
            className="min-h-10 w-full rounded-xl border-2 border-duo-border p-2 text-xs font-bold outline-none focus:border-duo-green"
            placeholder="Why did you save this?"
          />
          <div className="flex items-center justify-between gap-2">
            <time className="min-w-0 truncate text-xs font-bold text-duo-mute">
              Added {new Date(item.addedAt).toLocaleString()}
            </time>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void handleSaveNote(item.id)}
                disabled={busyId === item.id}
                className="chip text-xs"
              >
                {busyId === item.id ? '...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => void handleRemoveLinkNest(item)}
                disabled={linkNestDeleteId === item.id}
                className="chip text-xs"
              >
                {linkNestDeleteId === item.id ? '...' : 'Remove LinkNest'}
              </button>
              <button
                type="button"
                onClick={() => void handleRemove(item.id)}
                className="chip border-red-200 text-red-500 hover:bg-red-50 text-xs"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      </article>
    );
  }

  function renderChatResultCard(result: ChatResult) {
    const item = result.video;
    const kind = getSavedVideoKind(item);
    const video = videoById.get(item.id);
    const title = video?.title ?? (kind === 'webpage' ? getHostname(item.url) : item.url);
    const category = normalizeSavedVideoCategory(item.category);

    return (
      <article key={item.id} className="rounded-2xl border-2 border-duo-border bg-white p-2 shadow-card">
        <a href={item.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border-2 border-duo-border bg-duo-soft">
          {kind === 'youtube' ? (
            <img
              src={`https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`}
              alt=""
              className="aspect-video w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center px-3 text-center text-sm font-black text-duo-ink">
              {kind === 'instagram' ? 'Instagram saved video' : getHostname(item.url)}
            </div>
          )}
        </a>
        <div className="mt-2 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 min-w-0 text-sm font-extrabold text-duo-ink">{title}</h3>
            <span className="shrink-0 rounded-full bg-duo-green/10 px-2 py-1 text-[10px] font-black text-duo-greenDark">
              {result.confidence}%
            </span>
          </div>
          <p className="line-clamp-3 text-xs font-bold text-duo-mute">{item.note || 'No note'}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip cursor-default px-2 py-1 text-[10px]">{category}</span>
            {result.reason && <span className="text-[11px] font-bold text-duo-mute">{result.reason}</span>}
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="space-y-5">
          <section className="card p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCategorize()}
                  disabled={categorizePending || uncategorizedWithNoteCount === 0}
                  className="btn-duo-blue"
                >
                  {categorizePending ? 'Categorizing...' : 'AI categorize'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleImportLinkNest()}
                  disabled={linkNestPending}
                  className="btn-duo-green"
                >
                  {linkNestPending ? 'Fetching...' : 'Fetch LinkNest'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenFeed}
                  disabled={sorted.length === 0}
                  className="btn-duo-ghost"
                >
                  Watch Feed
                </button>
                <button
                  type="button"
                  onClick={() => setShortFeedOpen(true)}
                  className="btn-duo-ghost"
                  title="Fetch up to 50 YouTube Shorts by keyword + date range"
                >
                  Short Feed
                </button>
              </div>
              <span className="text-xs font-bold text-duo-mute">
                {uncategorizedWithNoteCount} uncategorized with notes
              </span>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto]"
              onSubmit={handleAdd}
            >
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDownCapture={stopExtensionShortcut}
                onKeyPressCapture={stopExtensionShortcut}
                onKeyUpCapture={stopExtensionShortcut}
                placeholder="Paste YouTube, Instagram, or webpage URL"
                className="min-w-0 rounded-chonk border-2 border-duo-border px-4 py-2 text-sm font-bold outline-none focus:border-duo-green"
                required
              />
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                onKeyDownCapture={stopExtensionShortcut}
                onKeyPressCapture={stopExtensionShortcut}
                onKeyUpCapture={stopExtensionShortcut}
                placeholder="Tag or note"
                className="min-w-0 rounded-chonk border-2 border-duo-border px-4 py-2 text-sm font-bold outline-none focus:border-duo-green"
              />
              <button type="submit" className="btn-duo-green" disabled={pending}>
                {pending ? '...' : 'Add'}
              </button>
            </form>
            {message && <p className="mt-3 text-sm font-bold text-duo-greenDark">{message}</p>}
            {error && <p className="mt-3 text-sm font-bold text-red-500">{error}</p>}
          </section>

          {sorted.length === 0 ? (
            <div className="card p-8 text-center font-bold text-duo-mute">No saved videos yet.</div>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <section key={group.category} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-extrabold text-duo-ink">{group.category}</h2>
                    <span className="chip cursor-default text-xs">{group.items.length}</span>
                  </div>
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map(renderSavedCard)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="card flex max-h-[calc(100vh-7rem)] min-h-[32rem] flex-col p-4 xl:sticky xl:top-24">
          <div className="border-b-2 border-duo-border pb-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-duo-greenDark">Video Chat</p>
            <h2 className="text-xl font-extrabold text-duo-ink">Search saved notes</h2>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3 pr-1">
            {chatMessages.map((chat) => (
              <div
                key={chat.id}
                className={
                  chat.role === 'user'
                    ? 'ml-auto max-w-[85%] rounded-2xl bg-duo-green px-3 py-2 text-sm font-bold text-white'
                    : 'max-w-full rounded-2xl border-2 border-duo-border bg-duo-soft px-3 py-2 text-sm font-bold text-duo-ink'
                }
              >
                <p>{chat.text}</p>
                {chat.results && chat.results.length > 0 && (
                  <div className="mt-3 space-y-3">{chat.results.map(renderChatResultCard)}</div>
                )}
              </div>
            ))}
            {chatPending && (
              <div className="w-fit rounded-2xl border-2 border-duo-border bg-duo-soft px-3 py-2 text-sm font-bold text-duo-mute">
                Searching notes...
              </div>
            )}
          </div>
          <form className="mt-3 flex gap-2 border-t-2 border-duo-border pt-3" onSubmit={handleChatSubmit}>
            <input
              value={chatQuery}
              onChange={(event) => setChatQuery(event.currentTarget.value)}
              onKeyDownCapture={stopExtensionShortcut}
              onKeyPressCapture={stopExtensionShortcut}
              onKeyUpCapture={stopExtensionShortcut}
              placeholder="Ask from saved notes"
              className="min-w-0 flex-1 rounded-chonk border-2 border-duo-border px-3 py-2 text-sm font-bold outline-none focus:border-duo-green"
            />
            <button type="submit" className="btn-duo-green px-4 py-2" disabled={chatPending || !chatQuery.trim()}>
              Ask
            </button>
          </form>
          {chatError && <p className="mt-2 text-xs font-bold text-red-500">{chatError}</p>}
        </aside>
      </div>

      {feedOpen && (
        <div className="fixed inset-0 z-50 bg-duo-ink/80 px-3 py-4 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden rounded-chonk border-2 border-duo-border bg-white shadow-card">
            <div className="flex items-center justify-between gap-3 border-b-2 border-duo-border bg-duo-soft px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-duo-greenDark">Watch Feed</p>
                <p className="text-xs font-bold text-duo-mute">Swipe or scroll through saved items.</p>
              </div>
              <button type="button" onClick={() => setFeedOpen(false)} className="btn-duo-ghost px-3 py-2 text-xs">
                Close
              </button>
            </div>
            <div ref={feedViewportRef} className="h-full snap-y snap-mandatory overflow-y-auto bg-black">
              {sorted.map((item) => (
                <section
                  key={item.id}
                  ref={(node) => {
                    feedItemRefs.current[item.id] = node;
                  }}
                  data-feed-id={item.id}
                  className="relative flex h-full snap-start flex-col bg-black"
                >
                  <div className="min-h-0 flex-1">{renderSavedPreview(item, true, activeFeedId === item.id)}</div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 text-white">
                    <p className="text-sm font-extrabold">{videoById.get(item.id)?.title ?? getHostname(item.url)}</p>
                    <p className="mt-1 text-xs font-bold text-white/75">{item.note || normalizeSavedVideoCategory(item.category)}</p>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      <VideoPlayerModal video={activeVideo} now={now} onClose={() => setActiveVideo(null)} />

      <ShortFeedDialog open={shortFeedOpen} onClose={() => setShortFeedOpen(false)} />
    </>
  );
}
