'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_CHANNEL_SPACE } from '@/lib/types';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export function AddChannelForm({ spaces }: { spaces: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; success?: string }>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedSpace, setSelectedSpace] = useState(spaces[0] ?? DEFAULT_CHANNEL_SPACE);

  useEffect(() => {
    if (!state.success) return;

    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
    window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
  }, [router, state.success]);

  useEffect(() => {
    if (spaces.includes(selectedSpace)) return;
    setSelectedSpace(spaces[0] ?? DEFAULT_CHANNEL_SPACE);
  }, [selectedSpace, spaces]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = inputRef.current?.value?.trim() ?? '';
    if (!url) {
      setState({ error: 'Please enter a channel URL or handle.' });
      return;
    }

    setPending(true);
    setState({});
    try {
      const response = await fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'addChannel', url, space: selectedSpace }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setState({ error: data.error ?? 'Failed to add channel.' });
        return;
      }

      setState({ success: String(data.success ?? '') });
    } catch {
      setState({ error: 'Failed to add channel.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <label className="min-w-0">
          <span className="sr-only">Channel URL or handle</span>
          <input
            ref={inputRef}
            name="url"
            type="text"
            placeholder="youtube.com/@handle or instagram.com/username"
            className="w-full rounded-chonk border-2 border-duo-border bg-white px-4 py-2 text-sm font-semibold text-duo-ink placeholder:text-duo-ink/40 focus:border-duo-green focus:outline-none"
            disabled={pending}
            required
          />
        </label>
        <label className="min-w-0">
          <span className="sr-only">Space</span>
          <select
            name="space"
            value={selectedSpace}
            onChange={(event) => setSelectedSpace(event.target.value)}
            className="w-full rounded-chonk border-2 border-duo-border bg-white px-3 py-2 text-sm font-bold text-duo-ink focus:border-duo-green focus:outline-none"
            disabled={pending}
          >
            {spaces.map((space) => (
              <option key={space} value={space}>
                {space}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-duo-green" disabled={pending}>
          {pending ? '...' : 'Add'}
        </button>
      </div>
      {state.error && <p className="text-sm font-bold text-red-500">{state.error}</p>}
      {state.success && <p className="text-sm font-bold text-duo-greenDark">Channel added! ({state.success})</p>}
    </form>
  );
}
