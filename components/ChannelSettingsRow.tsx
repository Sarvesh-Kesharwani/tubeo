'use client';

import Image from 'next/image';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_CHANNEL_SPACE } from '@/lib/types';

interface Props {
  id: string;
  title?: string;
  thumbnail?: string;
  fromEnv: boolean;
  currentSpace: string;
  spaces: string[];
}

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';
const CREATE_NEW_SPACE = '__new__';

export function ChannelSettingsRow({ id, title, thumbnail, fromEnv, currentSpace, spaces }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedSpace, setSelectedSpace] = useState(currentSpace);
  const [customSpace, setCustomSpace] = useState('');

  useEffect(() => {
    setSelectedSpace(currentSpace);
    setCustomSpace('');
  }, [currentSpace]);

  function handleRemove() {
    startTransition(() => {
      void fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'removeChannel', channelId: id }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) return;
        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  function handleMove() {
    const nextSpace = selectedSpace === CREATE_NEW_SPACE ? customSpace : selectedSpace;
    startTransition(() => {
      void fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'moveChannel', channelId: id, nextSpace }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) return;
        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  const normalizedDraft =
    (selectedSpace === CREATE_NEW_SPACE ? customSpace : selectedSpace).trim().replace(/\s+/g, ' ') ||
    DEFAULT_CHANNEL_SPACE;
  const isUnchanged = normalizedDraft === currentSpace;
  const isCustomSpace = selectedSpace === CREATE_NEW_SPACE;

  return (
    <div className="card space-y-3 px-4 py-3">
      <div className="flex items-center gap-3">
        {thumbnail ? (
          <Image src={thumbnail} alt="" width={36} height={36} className="rounded-full shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-duo-soft shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-duo-ink truncate">{title ?? id}</p>
          {title && <p className="text-xs text-duo-ink/50 font-mono truncate">{id}</p>}
          <p className="text-xs font-bold text-duo-greenDark mt-1">Current space: {currentSpace}</p>
        </div>
        {fromEnv && <span className="text-xs font-bold text-duo-ink/40 uppercase tracking-wide">env</span>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={selectedSpace}
            onChange={(event) => setSelectedSpace(event.target.value)}
            className="flex-1 px-4 py-2 rounded-chonk border-2 border-duo-border bg-white text-duo-ink focus:outline-none focus:border-duo-green font-semibold text-sm"
            disabled={pending}
          >
            {spaces.map((space) => (
              <option key={space} value={space}>
                {space}
              </option>
            ))}
            <option value={CREATE_NEW_SPACE}>+ Create new space</option>
          </select>

          <button
            type="button"
            onClick={handleMove}
            disabled={pending || isUnchanged || (isCustomSpace && !customSpace.trim())}
            className="btn-duo-blue text-xs px-3 py-2"
          >
            {pending ? '...' : 'Move'}
          </button>

          {!fromEnv && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending}
              className="btn-duo-ghost text-xs px-3 py-2 text-red-500 border-red-200 hover:bg-red-50"
            >
              {pending ? '...' : 'Remove'}
            </button>
          )}
        </div>

        {isCustomSpace && (
          <input
            value={customSpace}
            onChange={(event) => setCustomSpace(event.target.value)}
            placeholder="New space name"
            className="px-4 py-2 rounded-chonk border-2 border-duo-border bg-white text-duo-ink placeholder:text-duo-ink/40 focus:outline-none focus:border-duo-green font-semibold text-sm"
            disabled={pending}
          />
        )}
      </div>
    </div>
  );
}
