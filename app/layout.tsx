import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import { Suspense } from 'react';
import Link from 'next/link';
import { NavTabs } from '@/components/NavTabs';
import { AuthButton } from '@/components/AuthButton';
import { FeatureRequestMenu } from '@/components/FeatureRequestMenu';
import { SyncButton } from '@/components/SyncButton';
import './globals.css';

const nunito = Nunito({ subsets: ['latin'], weight: ['400', '700', '800', '900'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Tubeo',
  description: 'Curated feed of your favorite channels.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.className}>
      <body className="min-h-dvh">
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b-2 border-duo-border">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <Link href="/" className="flex items-center gap-2 font-extrabold text-xl text-duo-greenDark">
              <span aria-hidden>🦉</span>
              <span>Tubeo</span>
            </Link>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:gap-3">
              <FeatureRequestMenu />
              <SyncButton />
              <Link href="/settings" className="chip text-duo-ink/60 hover:text-duo-ink" title="Manage channels">
                ⚙️
              </Link>
              <Suspense fallback={null}>
                <AuthButton />
              </Suspense>
            </div>
          </div>
          <div className="border-t border-duo-border/60 bg-white/70">
            <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2">
              <Suspense fallback={null}>
                <NavTabs />
              </Suspense>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">{children}</main>
      </body>
    </html>
  );
}
