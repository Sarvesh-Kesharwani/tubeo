'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type RequestEntry = {
  id: string;
  description: string;
  createdAt: string;
  completed?: boolean;
  completedAt?: string;
};

const STORAGE_KEY = 'tubeo_feature_requests';

const DEFAULT_REQUESTS: RequestEntry[] = [
  {
    id: 'mobile-screen-support',
    description: 'Support for mobile screen.',
    createdAt: '2026-04-27T00:00:00.000Z',
  },
  {
    id: 'sync-stale-session',
    description:
      'Sync stops working if user leaves the app for some time after logging in and starts working when user logs out and logs back in.',
    createdAt: '2026-04-27T00:01:00.000Z',
  },
  {
    id: 'channel-space-order',
    description:
      'Ability to change order of spaces in channels page and save it as the user changes it.',
    createdAt: '2026-04-27T00:02:00.000Z',
  },
  {
    id: 'video-popup-comments',
    description:
      'Ability to view positive, negative, and top 5 comments on right side of the video popup.',
    createdAt: '2026-04-27T00:03:00.000Z',
  },
  {
    id: 'time-filter-persistence',
    description: "Time filter does not save user's last selected option like 24-hrs.",
    createdAt: '2026-04-27T00:04:00.000Z',
  },
  {
    id: 'updates-page',
    description:
      'Create a new page after channels called Updates, where user can select channels from a dropdown checklist and use the same videos/shorts and timeRange filters.',
    createdAt: '2026-04-27T00:05:00.000Z',
  },
  {
    id: 'videos-watchlist-page',
    description:
      'Create a Videos page with a video URL textbox, editable tag/name/small note, and saved added date/time, combining ShortStash watch-later purpose into Tubeo.',
    createdAt: '2026-04-27T00:06:00.000Z',
  },
  {
    id: 'move-add-channels',
    description: 'Move the add_channels section just above your_channels section.',
    createdAt: '2026-04-27T00:07:00.000Z',
  },
];

function loadRequests(): RequestEntry[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_REQUESTS;

    const parsed = JSON.parse(stored) as RequestEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_REQUESTS;
    return parsed.filter((item) => item?.id && item?.description && item?.createdAt);
  } catch {
    return DEFAULT_REQUESTS;
  }
}

export function FeatureRequestMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [requests, setRequests] = useState<RequestEntry[]>(DEFAULT_REQUESTS);
  const [confirm, setConfirm] = useState<{ id: string; action: 'complete' | 'delete' } | null>(null);

  useEffect(() => {
    const loaded = loadRequests();
    setRequests(loaded);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setConfirm(null);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function persist(next: RequestEntry[]) {
    setRequests(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  const addRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanDescription = description.trim();
    if (!cleanDescription) return;

    persist([
      {
        id: `request-${Date.now()}`,
        description: cleanDescription,
        createdAt: new Date().toISOString(),
      },
      ...requests,
    ]);
    setDescription('');
  };

  function completeRequest(id: string) {
    persist(
      requests.map((request) =>
        request.id === id
          ? { ...request, completed: true, completedAt: new Date().toISOString() }
          : request,
      ),
    );
    setConfirm(null);
  }

  function deleteRequest(id: string) {
    persist(requests.filter((request) => request.id !== id));
    setConfirm(null);
  }

  const pendingCount = requests.filter((request) => !request.completed).length;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="btn-duo-blue px-3 sm:px-4"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Feature and bug requests"
      >
        <span aria-hidden>+</span>
        <span className="hidden sm:inline">Request</span>
        <span className="rounded-full bg-white/25 px-2 text-xs">{pendingCount}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Feature and bug requests"
          className="absolute right-0 top-[calc(100%+0.75rem)] z-30 w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-chonk border-2 border-duo-border bg-white shadow-duo"
        >
          <div className="border-b-2 border-duo-border bg-duo-soft p-3">
            <form onSubmit={addRequest} className="flex gap-2">
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe request"
                className="min-w-0 flex-1 rounded-full border-2 border-duo-border bg-white px-3 py-2 text-sm font-bold outline-none focus:border-duo-blue"
              />
              <button type="submit" className="btn-duo-green px-3 text-xs">
                Add
              </button>
            </form>
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-3">
            <div className="space-y-2">
              {requests.map((request, index) => {
                const confirming = confirm?.id === request.id ? confirm.action : null;
                return (
                  <article
                    key={request.id}
                    className={`rounded-2xl border-2 border-duo-border bg-white p-3 shadow-card ${
                      request.completed ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-duo-blue/10 px-2 py-0.5 text-xs font-extrabold text-duo-blueDark">
                        #{requests.length - index}
                      </span>
                      <time className="text-xs font-bold text-duo-ink/40">
                        {new Date(request.createdAt).toLocaleDateString()}
                      </time>
                    </div>
                    <p
                      className={`text-sm font-bold leading-snug text-duo-ink ${
                        request.completed ? 'line-through' : ''
                      }`}
                    >
                      {request.description}
                    </p>

                    {confirming ? (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border-2 border-duo-border bg-duo-soft px-3 py-2">
                        <span className="text-xs font-extrabold text-duo-ink">
                          {confirming === 'delete' ? 'Delete this request?' : 'Mark as complete?'}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              confirming === 'delete'
                                ? deleteRequest(request.id)
                                : completeRequest(request.id)
                            }
                            className={`chip px-2 py-1 text-xs ${
                              confirming === 'delete'
                                ? 'border-red-300 text-red-500 hover:bg-red-50'
                                : 'border-duo-green text-duo-greenDark hover:bg-duo-green/10'
                            }`}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm(null)}
                            className="chip px-2 py-1 text-xs"
                          >
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {!request.completed && (
                          <button
                            type="button"
                            onClick={() => setConfirm({ id: request.id, action: 'complete' })}
                            className="chip px-2 py-1 text-xs"
                            title="Mark as complete"
                          >
                            <span aria-hidden>✓</span>
                            <span>Complete</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirm({ id: request.id, action: 'delete' })}
                          className="chip px-2 py-1 text-xs border-red-200 text-red-500 hover:bg-red-50"
                          title="Delete request"
                        >
                          <span aria-hidden>🗑</span>
                          <span>Delete</span>
                        </button>
                        {request.completed && request.completedAt && (
                          <span className="text-[10px] font-bold text-duo-mute">
                            Done {new Date(request.completedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
