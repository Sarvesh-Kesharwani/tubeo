'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export interface SpaceItem {
  space: string;
  count: number;
  controls: ReactNode;
  channels: ReactNode;
}

export function SpacesManager({ items }: { items: SpaceItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const itemBySpace = new Map(items.map((item) => [item.space, item]));
  const initialOrder = items.map((item) => item.space);
  const [order, setOrder] = useState(initialOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const lastSavedRef = useRef(initialOrder);

  useEffect(() => {
    lastSavedRef.current = initialOrder;
    setOrder(initialOrder);
  }, [initialOrder.join('|')]);

  function persist(next: string[]) {
    if (sameOrder(next, lastSavedRef.current)) return;
    lastSavedRef.current = next;

    startTransition(() => {
      void fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'setSpaceOrder', spaces: next }),
      }).then(() => {
        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  function moveTo(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    setOrder((current) => {
      const fromIndex = current.indexOf(draggingId);
      const toIndex = current.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return current;
      const next = [...current];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, draggingId);
      return next;
    });
  }

  return (
    <ul className="flex flex-col gap-3">
      {order.map((space) => {
        const item = itemBySpace.get(space);
        if (!item) return null;
        const isDragging = draggingId === space;
        const isOver = overId === space && draggingId !== null && draggingId !== space;
        return (
          <li
            key={space}
            onDragEnter={() => setOverId(space)}
            onDragOver={(event) => {
              if (!draggingId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              moveTo(space);
            }}
            onDragLeave={() => setOverId((current) => (current === space ? null : current))}
            onDrop={(event) => {
              if (!draggingId) return;
              event.preventDefault();
              setOverId(null);
              setDraggingId(null);
              persist(order);
            }}
            className={[
              'rounded-chonk border-2 bg-white shadow-card transition-colors',
              isDragging ? 'border-duo-blue opacity-70' : 'border-duo-border',
              isOver ? 'border-duo-green ring-2 ring-duo-green/20' : '',
            ].join(' ')}
          >
            <div
              draggable
              onDragStart={(event) => {
                setDraggingId(space);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', space);
              }}
              onDragEnd={() => {
                setOverId(null);
                setDraggingId(null);
                persist(order);
              }}
              className="flex cursor-grab items-center gap-3 border-b-2 border-duo-border bg-duo-soft px-4 py-3 active:cursor-grabbing"
              title="Drag to reorder spaces"
            >
              <span aria-hidden className="text-lg leading-none text-duo-ink/40">⋮⋮</span>
              <h3 className="min-w-0 flex-1 truncate text-base font-extrabold text-duo-ink">{space}</h3>
              <span className="chip cursor-default text-xs">{item.count}</span>
              {pending && draggingId === null && (
                <span className="text-[10px] font-bold text-duo-mute">saving</span>
              )}
            </div>
            <div className="space-y-3 p-4">
              <div onDragStart={(event) => event.stopPropagation()}>{item.controls}</div>
              {item.count > 0 && (
                <div onDragStart={(event) => event.stopPropagation()} className="space-y-2">
                  {item.channels}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
