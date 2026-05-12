'use client';

import { signIn } from 'next-auth/react';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/auth/')) return '/';
  return value;
}

export function SignInPopupClient() {
  const searchParams = useSearchParams();
  const startedRef = useRef(false);
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const redirectTo = `/auth/popup-complete?returnTo=${encodeURIComponent(returnTo)}`;
    void signIn('google', { redirectTo });
  }, [returnTo]);

  return (
    <main className="min-h-dvh bg-duo-soft px-5 py-8">
      <section className="card mx-auto max-w-sm p-5 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-duo-green text-xl font-black text-white">
          G
        </div>
        <h1 className="text-lg font-extrabold text-duo-ink">Opening Google</h1>
        <p className="mt-2 text-sm font-bold text-duo-mute">Continue with your Google account.</p>
      </section>
    </main>
  );
}
