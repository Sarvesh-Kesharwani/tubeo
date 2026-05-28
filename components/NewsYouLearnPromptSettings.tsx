'use client';

import { useState } from 'react';

export function NewsYouLearnPromptSettings({ initialPrompt }: { initialPrompt: string }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const dirty = prompt !== savedPrompt;
  const remaining = 8000 - prompt.length;

  async function save() {
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/news/youlearn/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as { ok?: boolean; prompt?: string; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed.');
      const nextPrompt = data.prompt ?? prompt;
      setSavedPrompt(nextPrompt);
      setPrompt(nextPrompt);
      setStatus('saved');
      setTimeout(() => setStatus((current) => (current === 'saved' ? 'idle' : current)), 2500);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="font-extrabold text-duo-ink">News YouLearn video prompt</h2>
        <p className="text-xs font-bold leading-relaxed text-duo-ink/50">
          Used when the News page processes the daily YouLearn transcript with DeepSeek. Leave empty to use Tubeo's default Hinglish summary prompt.
        </p>
      </div>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={7}
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
          <span className={`chip cursor-default text-[11px] ${remaining < 0 ? 'text-duo-red' : ''}`}>
            {remaining.toLocaleString()} left
          </span>
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
