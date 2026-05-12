'use client';

import Image from 'next/image';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SignInButton } from '@/components/SignInButton';
import { SignOutButton } from '@/components/SignOutButton';

type CachedUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type AuthSnapshot = {
  status: 'authenticated' | 'unauthenticated';
  user: CachedUser | null;
  checkedAt: number;
};

type SessionResponse = {
  user?: CachedUser | null;
};

const AUTH_CACHE_KEY = 'tubeo_auth_snapshot_v1';
const AUTH_EVENT = 'tubeo-auth-changed';
const AUTH_CACHE_TTL_MS = 60_000;

let memoryAuth: AuthSnapshot | null = null;
let authInflight: Promise<AuthSnapshot> | null = null;

function fallbackAuth(): AuthSnapshot {
  return { status: 'unauthenticated', user: null, checkedAt: 0 };
}

function readAuthCache(): AuthSnapshot | null {
  if (memoryAuth) return memoryAuth;
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSnapshot;
    if (parsed.status !== 'authenticated' && parsed.status !== 'unauthenticated') return null;
    memoryAuth = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeAuthCache(snapshot: AuthSnapshot) {
  memoryAuth = snapshot;
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(snapshot));
}

function clearAuthCache() {
  memoryAuth = null;
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_CACHE_KEY);
}

async function validateAuth(force = false): Promise<AuthSnapshot> {
  const cached = readAuthCache();
  if (!force && cached && Date.now() - cached.checkedAt < AUTH_CACHE_TTL_MS) return cached;
  if (authInflight) return authInflight;

  authInflight = fetch('/api/auth/session', {
    cache: 'no-store',
    credentials: 'same-origin',
  })
    .then(async (response) => {
      if (!response.ok) return fallbackAuth();
      const data = (await response.json()) as SessionResponse;
      const snapshot: AuthSnapshot = data.user
        ? { status: 'authenticated', user: data.user, checkedAt: Date.now() }
        : { status: 'unauthenticated', user: null, checkedAt: Date.now() };
      writeAuthCache(snapshot);
      return snapshot;
    })
    .catch(() => cached ?? fallbackAuth())
    .finally(() => {
      authInflight = null;
    });

  return authInflight;
}

function safeReturnTo(pathname: string, query: string): string {
  const value = query ? `${pathname}?${query}` : pathname;
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/auth/')) return '/';
  return value;
}

export function AuthButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = useMemo(
    () => safeReturnTo(pathname, searchParams.toString()),
    [pathname, searchParams],
  );
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => readAuthCache() ?? fallbackAuth());
  const [signingOut, setSigningOut] = useState(false);

  const refreshAuth = useCallback(async (force = false) => {
    const next = await validateAuth(force);
    setSnapshot(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void validateAuth(false).then((next) => {
      if (!cancelled) setSnapshot(next);
    });

    const onAuthChanged = () => {
      void validateAuth(true).then((next) => {
        if (!cancelled) setSnapshot(next);
      });
    };

    window.addEventListener(AUTH_EVENT, onAuthChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EVENT, onAuthChanged);
    };
  }, []);

  const handleSignedIn = useCallback(async () => {
    await refreshAuth(true);
    window.dispatchEvent(new CustomEvent(AUTH_EVENT));
    window.dispatchEvent(new CustomEvent('tubeo-sync-resume'));
    router.replace(returnTo);
    router.refresh();
  }, [refreshAuth, returnTo, router]);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    clearAuthCache();
    setSnapshot(fallbackAuth());

    window.sessionStorage.removeItem('tubeo_drive_pulled');
    window.localStorage.removeItem('tubeo_drive_pulled_at');
    window.localStorage.removeItem('tubeo_sync_state_v1');
    window.localStorage.removeItem('tubeo_filter_state_v1');

    try {
      await fetch('/api/auth/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAppState: true }),
      });
      await signOut({ redirect: false });
    } finally {
      setSigningOut(false);
      window.dispatchEvent(new CustomEvent(AUTH_EVENT));
      window.dispatchEvent(new CustomEvent('tubeo-sync-reset'));
      router.replace('/');
      router.refresh();
    }
  }, [router, signingOut]);

  if (snapshot.status !== 'authenticated' || !snapshot.user) {
    return <SignInButton returnTo={returnTo} onSignedIn={handleSignedIn} />;
  }

  return (
    <div className="flex items-center gap-2 chip">
      {snapshot.user.image && (
        <Image
          src={snapshot.user.image}
          alt={snapshot.user.name ?? 'User'}
          width={24}
          height={24}
          className="rounded-full"
        />
      )}
      <span className="hidden max-w-[120px] truncate text-sm font-bold sm:inline">
        {snapshot.user.name ?? snapshot.user.email}
      </span>
      <SignOutButton onSignOut={handleSignOut} pending={signingOut} />
    </div>
  );
}
