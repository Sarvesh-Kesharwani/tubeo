'use client';

import { useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';

export function HubSsoBridge() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const token = url.searchParams.get('hubToken');
    const embed = url.searchParams.get('hubEmbed');
    if (!token || embed !== 'toolshub') return;

    ran.current = true;

    // Strip token from URL — keep embed param for app to know it's framed
    url.searchParams.delete('hubToken');
    window.history.replaceState({}, '', url.toString());

    void (async () => {
      try {
        const res = await fetch('/api/auth/session', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const data = (await res.json().catch(() => ({}))) as { user?: unknown };
        if (data?.user) return;
      } catch {}

      try {
        await signIn('hub-sso', { token, redirect: false });
        window.dispatchEvent(new CustomEvent('tubeo-auth-changed'));
      } catch {}
    })();
  }, []);

  return null;
}
