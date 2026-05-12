'use client';

import { signIn } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';

const SIGNIN_COMPLETE_EVENT = 'tubeo:signin-complete';

function safeReturnTo(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/auth/')) return '/';
  return value;
}

export function SignInButton({
  returnTo = '/',
  onSignedIn,
}: {
  returnTo?: string;
  onSignedIn?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string } | null;
      if (data?.type !== SIGNIN_COMPLETE_EVENT) return;

      if (closeTimerRef.current) {
        window.clearInterval(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      popupRef.current?.close();
      popupRef.current = null;
      setPending(false);
      onSignedIn?.();
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (closeTimerRef.current) window.clearInterval(closeTimerRef.current);
    };
  }, [onSignedIn]);

  async function startSignIn() {
    if (pending) return;
    setPending(true);

    const target = safeReturnTo(returnTo);
    const features = [
      'popup=yes',
      'width=520',
      'height=680',
      'menubar=no',
      'toolbar=no',
      'location=yes',
      'resizable=yes',
      'scrollbars=yes',
    ].join(',');
    const popup = window.open('', 'tubeo-google-signin', features);
    popupRef.current = popup;

    try {
      await fetch('/api/auth/cleanup', { method: 'POST' });

      if (!popup) {
        await signIn('google', { redirectTo: target });
        return;
      }

      popup.location.href = `/auth/popup?returnTo=${encodeURIComponent(target)}`;
      closeTimerRef.current = window.setInterval(() => {
        if (!popup.closed) return;
        if (closeTimerRef.current) {
          window.clearInterval(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        popupRef.current = null;
        setPending(false);
      }, 500);
    } catch {
      popup?.close();
      await signIn('google', { redirectTo: target });
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      className="btn-duo-green text-sm disabled:cursor-wait disabled:opacity-70"
      onClick={() => void startSignIn()}
    >
      <span aria-hidden>{pending ? '...' : 'KEY'}</span> {pending ? 'Opening...' : 'Sign in'}
    </button>
  );
}
