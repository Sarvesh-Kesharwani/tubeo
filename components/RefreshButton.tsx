'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface RefreshButtonProps {
  /** Paths to revalidate after the cache is busted. Defaults to the current pathname. */
  paths?: string[];
  /** Button label. Defaults to "Refresh". */
  label?: string;
  /** Hint shown next to the button when there's no other status. */
  hint?: string;
}

export function RefreshButton({ paths, label = 'Refresh', hint }: RefreshButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; at: string; deleted: number | null }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  function handleClick() {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      try {
        const targets =
          paths && paths.length > 0
            ? paths
            : typeof window !== 'undefined'
              ? [window.location.pathname]
              : [];
        const res = await fetch('/api/yt-cache/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: targets }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          deletedRows?: number | null;
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `Refresh failed (${res.status})`);
        }

        setStatus({
          kind: 'success',
          at: new Date().toLocaleTimeString(),
          deleted: typeof data.deletedRows === 'number' ? data.deletedRows : null,
        });
        router.refresh();
      } catch (error) {
        setStatus({ kind: 'error', message: (error as Error).message });
      }
    });
  }

  const isBusy = pending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isBusy}
        className="btn-duo bg-white text-duo-blueDark border-2 border-duo-border shadow-card disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden className={isBusy ? 'inline-block animate-spin' : 'inline-block'}>
          {'↻'}
        </span>
        <span>{isBusy ? 'Refreshing…' : label}</span>
      </button>

      {status.kind === 'success' && (
        <span className="text-xs font-semibold text-duo-mute">
          Cleared at {status.at}
          {typeof status.deleted === 'number' ? ` · ${status.deleted} row${status.deleted === 1 ? '' : 's'}` : ''}
        </span>
      )}
      {status.kind === 'error' && (
        <span className="text-xs font-semibold text-duo-red">{status.message}</span>
      )}
      {status.kind === 'idle' && hint && (
        <span className="text-xs text-duo-mute">{hint}</span>
      )}
    </div>
  );
}
