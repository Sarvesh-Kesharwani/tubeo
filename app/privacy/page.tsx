import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Tubeo',
  description: 'How Tubeo handles your data.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <p className="mb-4">
        Tubeo is a personal video library that lets you save Instagram reels and YouTube videos for later
        viewing. This policy explains what data Tubeo collects, why, and how to delete it.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">What we collect</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>Instagram reel URLs you forward to @toolshub2026 via Instagram DM.</li>
        <li>Your Instagram sender ID (so Tubeo can reply to confirm the reel was saved).</li>
        <li>Your Google account email and display name when you sign in with Google.</li>
        <li>Your in-app settings, saved videos, watch history, and discovery preferences.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">How we use it</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>To save reels you forward and sync them across your devices.</li>
        <li>To reply to your Instagram DM with a save confirmation.</li>
        <li>To remember your channel lists, settings, and watch state when you sign in.</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-3">Sharing</h2>
      <p className="mb-4">
        We do not sell or share your data with third parties. Data is stored in Supabase (our database
        provider) and processed on Vercel (our hosting provider).
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">Data deletion</h2>
      <p className="mb-4">
        Email{' '}
        <a className="text-emerald-600 underline" href="mailto:sarveshkumar5513@gmail.com">
          sarveshkumar5513@gmail.com
        </a>{' '}
        with your Instagram username or Google email and we will purge all associated data within 7 days.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">Contact</h2>
      <p>
        Questions? Reach out at{' '}
        <a className="text-emerald-600 underline" href="mailto:sarveshkumar5513@gmail.com">
          sarveshkumar5513@gmail.com
        </a>
        .
      </p>
    </main>
  );
}
