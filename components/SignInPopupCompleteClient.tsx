'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const SIGNIN_COMPLETE_EVENT = 'tubeo:signin-complete';

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/auth/')) return '/';
  return value;
}

export function SignInPopupCompleteClient() {
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  useEffect(() => {
    if (!window.opener) return;
    window.opener.postMessage({ type: SIGNIN_COMPLETE_EVENT, returnTo }, window.location.origin);
    window.close();
  }, [returnTo]);

  return (
    <main className="min-h-dvh bg-duo-soft px-5 py-8">
      <section className="card mx-auto max-w-sm p-5 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-duo-green text-xl font-black text-white">
          OK
        </div>
        <h1 className="text-lg font-extrabold text-duo-ink">Signed in</h1>
        <Link href={returnTo} className="btn-duo-green mt-4 inline-flex">
          Return to Tubeo
        </Link>
      </section>
    </main>
  );
}
