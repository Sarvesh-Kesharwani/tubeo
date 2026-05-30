'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'tubeo_news_youlearn_prompt_v1';

interface StoredPrompt {
  prompt: string;
  updatedAt: string;
}

function readStoredPrompt(): StoredPrompt | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<StoredPrompt> | null;
    if (!parsed || typeof parsed.prompt !== 'string' || typeof parsed.updatedAt !== 'string') return null;
    return { prompt: parsed.prompt, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

function writeStoredPrompt(value: StoredPrompt) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function NewsYouLearnPromptSettings({
  initialPrompt,
  initialUpdatedAt,
}: {
  initialPrompt: string;
  initialUpdatedAt: string | null;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [savedAt, setSavedAt] = useState(initialUpdatedAt ?? new Date(0).toISOString());
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const dirty = prompt !== savedPrompt;
  const remaining = 8000 - prompt.length;

  useEffect(() => {
    const local = readStoredPrompt();
    const localTime = local ? Date.parse(local.updatedAt) : 0;
    const serverTime = Date.parse(savedAt);
    if (local && Number.isFinite(localTime) && localTime > (Number.isFinite(serverTime) ? serverTime : 0)) {
      setPrompt(local.prompt);
    }
  }, [savedAt]);

  async function save() {
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/news/youlearn/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as { ok?: boolean; prompt?: string; updatedAt?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed.');
      const nextPrompt = data.prompt ?? prompt;
      const nextUpdatedAt = data.updatedAt ?? new Date().toISOString();
      writeStoredPrompt({ prompt: nextPrompt, updatedAt: nextUpdatedAt });
      setSavedPrompt(nextPrompt);
      setPrompt(nextPrompt);
      setSavedAt(nextUpdatedAt);
      setStatus('saved');
      setTimeout(() => setStatus((current) => (current === 'saved' ? 'idle' : current)), 2500);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-extrabold text-duo-ink">News YouLearn video prompt</h2>
        <span className={`chip cursor-default text-[11px] ${remaining < 0 ? 'text-duo-red' : ''}`}>
          {remaining.toLocaleString()} left
        </span>
      </div>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={5}
        spellCheck={false}
        placeholder='Example: Return JSON {"title":"...","key_points":["..."],"why_it_matters":["..."],"terms":[{"term":"...","meaning":"..."}],"revision_notes":["..."]}. Use Hinglish.'
        className="w-full resize-y rounded-2xl border-2 border-duo-border bg-white p-3 font-mono text-[13px] leading-relaxed text-duo-ink focus:border-duo-blue focus:outline-none"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-bold text-duo-mute">
          {dirty && <span className="text-duo-blueDark">Unsaved changes</span>}
          {status === 'saved' && <span className="text-duo-greenDark">Saved.</span>}
          {status === 'error' && error && <span className="text-duo-red">{error}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={save}
            disabled={!dirty || status === 'saving' || prompt.length > 8000}
          >
            {status === 'saving' ? 'Saving...' : 'Save prompt'}
          </button>
        </div>
      </div>
    </section>
  );
}
