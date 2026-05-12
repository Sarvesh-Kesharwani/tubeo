'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export interface SpaceChannelItem {
  id: string;
  fromEnv: boolean;
  node: ReactNode;
}

export function SpaceChannelsList({ space, items }: { space: string; items: SpaceChannelItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialOrder = items.map((item) => item.id);
  const [order, setOrder] = useState(initialOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const lastSavedRef = useRef(initialOrder);
  const itemById = new Map(items.map((item) => [item.id, item]));

  useEffect(() => {
    lastSavedRef.current = initialOrder;
    setOrder(initialOrder);
  }, [initialOrder.join('|')]);

  function moveTo(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    const targetItem = itemById.get(targetId);
    if (targetItem?.fromEnv) return;
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

  function persist(next: string[]) {
    if (sameOrder(next, lastSavedRef.current)) return;
    lastSavedRef.current = next;

    startTransition(() => {
      void fetch('/api/settings/mutate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'setChannelOrderInSpace', space, channelIds: next }),
      }).then(() => {
        router.refresh();
        window.dispatchEvent(new CustomEvent(CHANNELS_CHANGED_EVENT, { detail: { autoSync: true } }));
      });
    });
  }

  return (
    <ul className="space-y-2">
      {order.map((id) => {
        const item = itemById.get(id);
        if (!item) return null;
        const draggable = !item.fromEnv;
        const isDragging = draggingId === id;
        const isOver = overId === id && draggingId !== null && draggingId !== id && draggable;

        return (
          <li
            key={id}
            onDragEnter={() => {
              if (!draggable) return;
              setOverId(id);
            }}
            onDragOver={(event) => {
              if (!draggingId || !draggable) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              moveTo(id);
            }}
            onDragLeave={() => setOverId((current) => (current === id ? null : current))}
            onDrop={(event) => {
              if (!draggingId) return;
              event.preventDefault();
              setOverId(null);
              setDraggingId(null);
              persist(order);
            }}
            className={[
              'rounded-chonk transition-colors',
              isDragging ? 'opacity-60' : '',
              isOver ? 'ring-2 ring-duo-green/40' : '',
            ].join(' ')}
          >
            <div
              draggable={draggable}
              onDragStart={(event) => {
                if (!draggable) {
                  event.preventDefault();
                  return;
                }
                event.stopPropagation();
                setDraggingId(id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', id);
              }}
              onDragEnd={() => {
                setOverId(null);
                setDraggingId(null);
                persist(order);
              }}
              className={draggable ? 'cursor-grab active:cursor-grabbing' : ''}
              title={draggable ? 'Drag to reorder channels in this space' : undefined}
            >
              {item.node}
            </div>
          </li>
        );
      })}
      {pending && (
        <li className="text-[10px] font-bold text-duo-mute">saving channel order...</li>
      )}
    </ul>
  );
}

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
