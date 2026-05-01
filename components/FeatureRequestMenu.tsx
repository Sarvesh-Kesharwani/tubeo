'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

type RequestEntry = {
  id: string;
  description: string;
  createdAt: string;
  completed?: boolean;
  completedAt?: string;
  category: string;
};

type CategoryDef = {
  id: string;
  label: string;
  builtin?: boolean;
};

const STORAGE_KEY = 'tubeo_feature_requests';
const CATEGORIES_KEY = 'tubeo_feature_categories';

const BUILTIN_CATEGORIES: CategoryDef[] = [
  { id: 'high', label: 'High', builtin: true },
  { id: 'medium', label: 'Medium', builtin: true },
  { id: 'low', label: 'Low', builtin: true },
];

const DEFAULT_CATEGORY = 'low';

const DEFAULT_REQUESTS: RequestEntry[] = [
  {
    id: 'mobile-screen-support',
    description: 'Support for mobile screen.',
    createdAt: '2026-04-27T00:00:00.000Z',
    category: 'low',
  },
  {
    id: 'sync-stale-session',
    description:
      'Sync stops working if user leaves the app for some time after logging in and starts working when user logs out and logs back in.',
    createdAt: '2026-04-27T00:01:00.000Z',
    category: 'low',
  },
  {
    id: 'channel-space-order',
    description:
      'Ability to change order of spaces in channels page and save it as the user changes it.',
    createdAt: '2026-04-27T00:02:00.000Z',
    category: 'low',
  },
  {
    id: 'video-popup-comments',
    description:
      'Ability to view positive, negative, and top 5 comments on right side of the video popup.',
    createdAt: '2026-04-27T00:03:00.000Z',
    category: 'low',
  },
  {
    id: 'time-filter-persistence',
    description: "Time filter does not save user's last selected option like 24-hrs.",
    createdAt: '2026-04-27T00:04:00.000Z',
    category: 'low',
  },
  {
    id: 'updates-page',
    description:
      'Create a new page after channels called Updates, where user can select channels from a dropdown checklist and use the same videos/shorts and timeRange filters.',
    createdAt: '2026-04-27T00:05:00.000Z',
    category: 'low',
  },
  {
    id: 'videos-watchlist-page',
    description:
      'Create a Videos page with a video URL textbox, editable tag/name/small note, and saved added date/time, combining ShortStash watch-later purpose into Tubeo.',
    createdAt: '2026-04-27T00:06:00.000Z',
    category: 'low',
  },
  {
    id: 'move-add-channels',
    description: 'Move the add_channels section just above your_channels section.',
    createdAt: '2026-04-27T00:07:00.000Z',
    category: 'low',
  },
];

function loadRequests(): RequestEntry[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_REQUESTS;

    const parsed = JSON.parse(stored) as RequestEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_REQUESTS;
    return parsed
      .filter((item) => item?.id && item?.description && item?.createdAt)
      .map((item) => ({ ...item, category: item.category || DEFAULT_CATEGORY }));
  } catch {
    return DEFAULT_REQUESTS;
  }
}

function loadCategories(): CategoryDef[] {
  try {
    const stored = window.localStorage.getItem(CATEGORIES_KEY);
    if (!stored) return BUILTIN_CATEGORIES;
    const parsed = JSON.parse(stored) as CategoryDef[];
    if (!Array.isArray(parsed) || parsed.length === 0) return BUILTIN_CATEGORIES;
    const customs = parsed.filter((c) => c?.id && c?.label && !c.builtin);
    return [...BUILTIN_CATEGORIES, ...customs];
  } catch {
    return BUILTIN_CATEGORIES;
  }
}

export function FeatureRequestMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [requests, setRequests] = useState<RequestEntry[]>(DEFAULT_REQUESTS);
  const [categories, setCategories] = useState<CategoryDef[]>(BUILTIN_CATEGORIES);
  const [confirm, setConfirm] = useState<
    | { id: string; action: 'complete' | 'delete' }
    | { id: string; action: 'delete-category' }
    | null
  >(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');

  useEffect(() => {
    const loaded = loadRequests();
    setRequests(loaded);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
    const loadedCats = loadCategories();
    setCategories(loadedCats);
    const customs = loadedCats.filter((c) => !c.builtin);
    window.localStorage.setItem(CATEGORIES_KEY, JSON.stringify(customs));
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setConfirm(null);
        setMovingId(null);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  function persist(next: RequestEntry[]) {
    setRequests(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function persistCategories(next: CategoryDef[]) {
    setCategories(next);
    const customs = next.filter((c) => !c.builtin);
    window.localStorage.setItem(CATEGORIES_KEY, JSON.stringify(customs));
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
        category: DEFAULT_CATEGORY,
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

  function moveRequest(id: string, categoryId: string) {
    persist(requests.map((r) => (r.id === id ? { ...r, category: categoryId } : r)));
    setMovingId(null);
  }

  async function copyRequest(request: RequestEntry) {
    try {
      await navigator.clipboard.writeText(request.description);
      setCopiedId(request.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === request.id ? null : prev));
      }, 1200);
    } catch {
      // ignore
    }
  }

  function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = newCategoryLabel.trim();
    if (!label) return;
    const id = `cat-${Date.now()}`;
    persistCategories([...categories, { id, label }]);
    setNewCategoryLabel('');
    setShowAddCategory(false);
  }

  function deleteCategory(id: string) {
    const target = categories.find((c) => c.id === id);
    if (!target || target.builtin) return;
    persistCategories(categories.filter((c) => c.id !== id));
    persist(
      requests.map((r) => (r.category === id ? { ...r, category: DEFAULT_CATEGORY } : r)),
    );
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
          className="fixed left-2 right-2 top-[3.75rem] sm:absolute sm:inset-x-auto sm:left-auto sm:right-0 sm:top-[calc(100%+0.75rem)] z-30 w-auto sm:w-[26rem] sm:max-w-[calc(100vw-1rem)] overflow-hidden rounded-chonk border-2 border-duo-border bg-white shadow-duo"
        >
          <div className="border-b-2 border-duo-border bg-duo-soft p-3 space-y-2">
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

            {showAddCategory ? (
              <form onSubmit={addCategory} className="flex gap-2">
                <input
                  value={newCategoryLabel}
                  onChange={(event) => setNewCategoryLabel(event.target.value)}
                  placeholder="Category name"
                  className="min-w-0 flex-1 rounded-full border-2 border-duo-border bg-white px-3 py-1.5 text-xs font-bold outline-none focus:border-duo-blue"
                />
                <button type="submit" className="chip px-2 py-1 text-xs border-duo-green text-duo-greenDark hover:bg-duo-green/10">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddCategory(false);
                    setNewCategoryLabel('');
                  }}
                  className="chip px-2 py-1 text-xs"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddCategory(true)}
                className="chip px-2 py-1 text-xs"
              >
                <span aria-hidden>+</span>
                <span>New category</span>
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-3">
            <div className="space-y-4">
              {categories.map((category) => {
                const items = requests.filter((r) => r.category === category.id);
                const confirmingDeleteCat =
                  confirm && 'action' in confirm && confirm.action === 'delete-category' && confirm.id === category.id;
                return (
                  <section key={category.id}>
                    <header className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-extrabold uppercase tracking-wide text-duo-ink/70">
                        {category.label}
                        <span className="ml-2 rounded-full bg-duo-blue/10 px-2 py-0.5 text-[10px] text-duo-blueDark">
                          {items.length}
                        </span>
                      </h3>
                      {!category.builtin && !confirmingDeleteCat && (
                        <button
                          type="button"
                          onClick={() => setConfirm({ id: category.id, action: 'delete-category' })}
                          className="text-[10px] font-bold text-red-500 hover:underline"
                          title="Delete category"
                        >
                          Delete category
                        </button>
                      )}
                      {confirmingDeleteCat && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => deleteCategory(category.id)}
                            className="chip px-2 py-0.5 text-[10px] border-red-300 text-red-500 hover:bg-red-50"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm(null)}
                            className="chip px-2 py-0.5 text-[10px]"
                          >
                            No
                          </button>
                        </div>
                      )}
                    </header>

                    {items.length === 0 ? (
                      <p className="rounded-2xl border-2 border-dashed border-duo-border/50 bg-duo-soft/30 p-3 text-center text-[11px] font-bold text-duo-mute">
                        No requests
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {items.map((request) => {
                          const confirming =
                            confirm && 'action' in confirm && confirm.id === request.id
                              ? confirm.action
                              : null;
                          const isMoving = movingId === request.id;
                          return (
                            <article
                              key={request.id}
                              className={`rounded-2xl border-2 border-duo-border bg-white p-3 shadow-card ${
                                request.completed ? 'opacity-60' : ''
                              }`}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
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

                              {confirming === 'complete' || confirming === 'delete' ? (
                                <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border-2 border-duo-border bg-duo-soft px-3 py-2">
                                  <span className="text-xs font-extrabold text-duo-ink">
                                    {confirming === 'delete'
                                      ? 'Delete this request?'
                                      : 'Mark as complete?'}
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
                              ) : isMoving ? (
                                <div className="mt-2 rounded-2xl border-2 border-duo-border bg-duo-soft p-2">
                                  <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-duo-ink/60">
                                    Move to
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {categories
                                      .filter((c) => c.id !== request.category)
                                      .map((c) => (
                                        <button
                                          key={c.id}
                                          type="button"
                                          onClick={() => moveRequest(request.id, c.id)}
                                          className="chip px-2 py-1 text-xs"
                                        >
                                          {c.label}
                                        </button>
                                      ))}
                                    <button
                                      type="button"
                                      onClick={() => setMovingId(null)}
                                      className="chip px-2 py-1 text-xs"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  {!request.completed && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirm({ id: request.id, action: 'complete' })
                                      }
                                      className="chip px-2 py-1 text-xs"
                                      title="Mark as complete"
                                    >
                                      <span aria-hidden>✓</span>
                                      <span>Complete</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => copyRequest(request)}
                                    className="chip px-2 py-1 text-xs"
                                    title="Copy description"
                                  >
                                    <span aria-hidden>{copiedId === request.id ? '✓' : '⧉'}</span>
                                    <span>{copiedId === request.id ? 'Copied' : 'Copy'}</span>
                                  </button>
                                  {!request.completed && (
                                    <button
                                      type="button"
                                      onClick={() => setMovingId(request.id)}
                                      className="chip px-2 py-1 text-xs"
                                      title="Move to another category"
                                    >
                                      <span aria-hidden>↪</span>
                                      <span>Move</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setConfirm({ id: request.id, action: 'delete' })
                                    }
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
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
