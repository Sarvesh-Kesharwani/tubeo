'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Channel } from '@/lib/types';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export function UpdatesChannelSelector({
  channels,
  selectedIds,
}: {
  channels: Channel[];
  selectedIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggle(channelId: string) {
    const next = new Set(selected);
    if (next.has(channelId)) next.delete(channelId);
    else next.add(channelId);

    startTransition(() => {
      void fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'setUpdatesChannels', channelIds: [...next] }),
      }).then(() => {
        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  return (
    <div className="relative max-w-full">
      <button type="button" onClick={() => setOpen((value) => !value)} className="btn-duo-blue">
        Updates channels
        <span className="rounded-full bg-white/25 px-2 text-xs">{selected.size}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-chonk border-2 border-duo-border bg-white shadow-duo">
          <div className="border-b-2 border-duo-border bg-duo-soft px-4 py-3 text-sm font-extrabold text-duo-ink">
            {pending ? 'Saving...' : 'Morning update list'}
          </div>
          <div className="max-h-[55vh] overflow-y-auto p-2">
            {channels.map((channel) => (
              <label
                key={channel.id}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2 hover:bg-duo-soft"
              >
                <span className="min-w-0 truncate text-sm font-bold text-duo-ink">{channel.title}</span>
                <input
                  type="checkbox"
                  checked={selected.has(channel.id)}
                  onChange={() => toggle(channel.id)}
                  disabled={pending}
                  className="h-5 w-5 accent-duo-green"
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
