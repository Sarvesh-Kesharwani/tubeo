'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VocabItem } from '@/lib/types';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

function mergeVocabs(current: VocabItem[], incoming: VocabItem[]): VocabItem[] {
  const seen = new Set<string>();
  const merged: VocabItem[] = [];

  for (const vocab of [...incoming, ...current]) {
    if (!vocab.id || seen.has(vocab.id)) continue;
    seen.add(vocab.id);
    merged.push(vocab);
  }

  return merged;
}

export function VocabClient({ vocabs }: { vocabs: VocabItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(vocabs);
  const [word, setWord] = useState('');
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems((current) => mergeVocabs(current, vocabs));
  }, [vocabs]);

  async function mutate(body: Record<string, unknown>): Promise<{
    ok: boolean;
    data: {
      vocab?: VocabItem;
      success?: string;
      synced?: boolean;
      meaningError?: string | null;
      error?: string;
    } | null;
  }> {
    const response = await fetch('/api/settings/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null) as {
      vocab?: VocabItem;
      success?: string;
      synced?: boolean;
      meaningError?: string | null;
      error?: string;
    } | null;
    return { ok: response.ok, data };
  }

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const { ok, data } = await mutate({ type: 'addVocab', word });
      if (!ok || data?.error) {
        setError(data?.error ?? 'Failed to add word.');
        return;
      }
      if (data?.vocab) {
        setItems((current) => [data.vocab!, ...current.filter((item) => item.id !== data.vocab!.id)]);
      }
      if (data?.meaningError) {
        setError(`Saved, but meaning lookup failed: ${data.meaningError}`);
      }
      setWord('');
      router.refresh();
      window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: !data?.synced } }));
    } catch {
      setError('Failed to add word.');
    } finally {
      setPending(false);
    }
  }

  async function handleRefetch(id: string) {
    if (busyId) return;
    setError(null);
    setBusyId(id);
    setItems((current) => current.map((item) => (item.id === id ? { ...item, status: 'pending' } : item)));
    try {
      const { ok, data } = await mutate({ type: 'refetchVocabMeaning', id });
      if (!ok || data?.error) {
        setError(data?.error ?? 'Failed to refetch meaning.');
        setItems((current) => current.map((item) => (item.id === id ? { ...item, status: 'failed' } : item)));
        return;
      }
      if (data?.vocab) {
        setItems((current) => current.map((item) => (item.id === id ? data.vocab! : item)));
      }
      if (data?.meaningError) {
        setError(`Lookup failed: ${data.meaningError}`);
      }
      router.refresh();
      window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: !data?.synced } }));
    } catch {
      setError('Failed to refetch meaning.');
      setItems((current) => current.map((item) => (item.id === id ? { ...item, status: 'failed' } : item)));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    if (busyId) return;
    setError(null);
    setBusyId(id);
    try {
      const { ok, data } = await mutate({ type: 'removeVocab', id });
      if (!ok || data?.error) {
        setError(data?.error ?? 'Failed to remove word.');
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
      router.refresh();
      window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: !data?.synced } }));
    } catch {
      setError('Failed to remove word.');
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...items].sort((a, b) => {
    const aTime = a.addedAt ? new Date(a.addedAt).getTime() : 0;
    const bTime = b.addedAt ? new Date(b.addedAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <>
      <section className="card p-4 sm:p-5">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={handleAdd}
        >
          <input
            value={word}
            onChange={(event) => setWord(event.target.value)}
            placeholder="Enter a word or short phrase"
            className="min-w-0 rounded-chonk border-2 border-duo-border px-4 py-2 text-sm font-bold outline-none focus:border-duo-green"
            required
          />
          <button type="submit" className="btn-duo-green" disabled={pending}>
            {pending ? '...' : 'Add'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm font-bold text-red-500">{error}</p>}
      </section>

      {sorted.length === 0 ? (
        <div className="card p-8 text-center font-bold text-duo-mute">
          No words yet. Add one above.
        </div>
      ) : (
        <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {sorted.map((vocab) => {
            const isBusy = busyId === vocab.id;
            return (
              <li key={vocab.id} className="card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-extrabold text-duo-ink break-words">
                    {vocab.word}
                  </h3>
                  <span
                    className={[
                      'chip cursor-default text-[10px]',
                      vocab.status === 'ready' ? 'text-duo-greenDark border-duo-green/40' : '',
                      vocab.status === 'pending' ? 'text-duo-ink/60' : '',
                      vocab.status === 'failed' ? 'text-red-500 border-red-200' : '',
                    ].join(' ')}
                  >
                    {vocab.status === 'ready' ? 'Defined' : vocab.status === 'pending' ? 'Pending' : 'Failed'}
                  </span>
                </div>

                {vocab.meaning ? (
                  <p className="whitespace-pre-wrap text-sm text-duo-ink/80 leading-relaxed">
                    {vocab.meaning}
                  </p>
                ) : (
                  <p className="text-xs font-bold text-duo-mute">
                    {vocab.status === 'failed'
                      ? 'Meaning lookup failed. Use Refetch to try again.'
                      : 'Looking up meaning...'}
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <time className="text-[11px] font-bold text-duo-mute">
                    Added {new Date(vocab.addedAt).toLocaleString()}
                  </time>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRefetch(vocab.id)}
                      disabled={isBusy}
                      className="chip text-xs"
                    >
                      {isBusy ? '...' : 'Refetch'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemove(vocab.id)}
                      disabled={isBusy}
                      className="chip border-red-200 text-red-500 hover:bg-red-50 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
