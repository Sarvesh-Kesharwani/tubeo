'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const CHANNELS_CHANGED_EVENT = 'tubeo-channels-changed';

export function SpaceOrderControls({ spaces }: { spaces: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState(spaces);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const lastSavedRef = useRef(spaces);

  useEffect(() => {
    if (sameOrder(spaces, lastSavedRef.current)) {
      lastSavedRef.current = spaces;
    }
    setOrder(spaces);
  }, [spaces]);

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

  if (order.length <= 1) return null;

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-extrabold text-duo-ink">Space order</h2>
          <p className="text-xs font-bold text-duo-ink/50">Drag a space card to change the order.</p>
        </div>
        {pending && <span className="text-xs font-bold text-duo-mute">Saving...</span>}
      </div>
      <ul className="flex flex-col gap-2">
        {order.map((space) => {
          const isDragging = draggingId === space;
          const isOver = overId === space && draggingId !== null && draggingId !== space;
          return (
            <li
              key={space}
              draggable
              onDragStart={(event) => {
                setDraggingId(space);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', space);
              }}
              onDragEnter={() => setOverId(space)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                moveTo(space);
              }}
              onDragLeave={() => setOverId((current) => (current === space ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOverId(null);
                setDraggingId(null);
                persist(order);
              }}
              onDragEnd={() => {
                setOverId(null);
                setDraggingId(null);
                persist(order);
              }}
              className={[
                'flex cursor-grab items-center justify-between gap-3 rounded-2xl border-2 px-3 py-2 active:cursor-grabbing',
                isDragging ? 'border-duo-blue bg-duo-blue/10 opacity-70' : 'border-duo-border bg-duo-soft',
                isOver ? 'border-duo-green bg-duo-green/10' : '',
              ].join(' ')}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="text-duo-ink/40">⋮⋮</span>
                <span className="min-w-0 truncate text-sm font-extrabold text-duo-ink">{space}</span>
              </div>
              <span className="chip cursor-default text-xs">drag</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
