'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'tubeo_news_prompt_v1';

interface PersistedPrompt {
  prompt: string;
  updatedAt: string;
}

function loadLocal(): PersistedPrompt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPrompt;
    if (typeof parsed.prompt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLocal(value: PersistedPrompt): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable. Supabase is still the source of truth.
  }
}

export function NewsPromptEditor({
  initialPrompt,
  initialUpdatedAt,
}: {
  initialPrompt: string;
  initialUpdatedAt: string | null;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const local = loadLocal();
    if (!local) return;
    const localTime = Date.parse(local.updatedAt);
    const serverTime = initialUpdatedAt ? Date.parse(initialUpdatedAt) : 0;
    if (Number.isFinite(localTime) && localTime > serverTime && local.prompt !== initialPrompt) {
      setPrompt(local.prompt);
      setSavedPrompt(local.prompt);
      setUpdatedAt(local.updatedAt);
    }
  }, [initialPrompt, initialUpdatedAt]);

  async function savePrompt(): Promise<boolean> {
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/news/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as { ok?: boolean; prompt?: string; updatedAt?: string; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      const persisted: PersistedPrompt = {
        prompt: data.prompt ?? prompt,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      };
      saveLocal(persisted);
      setSavedPrompt(persisted.prompt);
      setUpdatedAt(persisted.updatedAt);
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
      return true;
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
      return false;
    }
  }

  async function handleSave() {
    const ok = await savePrompt();
    if (ok) setOpen(false);
  }

  const dirty = prompt !== savedPrompt;
  const remaining = 8000 - prompt.length;

  return (
    <>
      <button
        type="button"
        className="btn-duo bg-white text-duo-blueDark shadow-duo"
        onClick={() => setOpen(true)}
      >
        Prompt
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-duo-ink/35 p-4">
          <section className="card max-h-[88vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold text-duo-blueDark">DeepSeek prompt</h3>
                <p className="mt-1 text-xs text-duo-mute">
                  Saved prompt stays hidden here. Fetch uses this prompt until you update it.
                </p>
              </div>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setPrompt(savedPrompt);
                  setStatus('idle');
                  setError(null);
                  setOpen(false);
                }}
              >
                Close
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-duo-mute">
                {updatedAt ? `Synced ${new Date(updatedAt).toLocaleString()}` : 'Not synced yet.'}
                {dirty && <span className="ml-2 font-semibold text-duo-blueDark">Unsaved changes</span>}
                {status === 'saved' && <span className="ml-2 font-semibold text-duo-green">Saved.</span>}
              </span>
              <span className={`chip cursor-default text-[11px] ${remaining < 0 ? 'text-duo-red' : ''}`}>
                {remaining.toLocaleString()} left
              </span>
            </div>

            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={10}
              spellCheck={false}
              placeholder={
                'Example:\nReturn JSON: { "topics": [ { "title": "...", "why_it_matters": "...", "bullets": ["..."], "tags": ["GS2","Polity"] } ] }\nKeep bullets under 25 words. Up to 12 topics.'
              }
              className="mt-3 w-full resize-y rounded-2xl border-2 border-duo-border bg-white p-3 font-mono text-[13px] leading-relaxed text-duo-ink focus:border-duo-blue focus:outline-none"
            />

            {status === 'error' && error && (
              <div className="mt-3 rounded-chonk border-2 border-duo-red bg-white px-4 py-3 text-sm font-semibold text-duo-red">
                {error}
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {dirty && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    setPrompt(savedPrompt);
                    setStatus('idle');
                    setError(null);
                  }}
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                className="btn-duo bg-duo-blue text-white shadow-duoBlue disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleSave}
                disabled={status === 'saving' || !dirty || prompt.length > 8000}
              >
                {status === 'saving' ? 'Saving...' : 'Save prompt'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
