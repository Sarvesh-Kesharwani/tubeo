import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Deletion — Tubeo',
  description: 'How to request deletion of your Tubeo data.',
};

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-slate-800">
      <h1 className="text-3xl font-bold mb-6">Data Deletion Instructions</h1>

      {code && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold mb-1">Deletion request received</p>
          <p>
            Your confirmation code is{' '}
            <code className="bg-white px-2 py-0.5 rounded">{code}</code>. Reference this code if you need to
            check on the status of your deletion request.
          </p>
        </div>
      )}

      <p className="mb-4">
        Tubeo stores the Instagram reels you forward to @toolshub2026, your Google account email if you sign
        in, your saved videos, and your in-app settings. You can request full deletion of this data at any
        time using the steps below.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-3">How to request deletion</h2>
      <ol className="list-decimal pl-6 space-y-2">
        <li>
          Email{' '}
          <a className="text-emerald-600 underline" href="mailto:sarveshkumar5513@gmail.com">
            sarveshkumar5513@gmail.com
          </a>{' '}
          from the email address associated with your Tubeo account (or include your Instagram username if
          you only used the DM-forwarding integration).
        </li>
        <li>
          Use the subject line <strong>&ldquo;Tubeo data deletion request&rdquo;</strong>.
        </li>
        <li>
          We confirm receipt within 2 business days and permanently delete all associated data within 7 days.
        </li>
      </ol>

      <h2 className="text-xl font-semibold mt-8 mb-3">What gets deleted</h2>
      <ul className="list-disc pl-6 space-y-2">
        <li>All saved reels and videos linked to your account.</li>
        <li>Your Instagram sender ID and any forwarded reel history.</li>
        <li>Your Google account email, display name, and OAuth tokens.</li>
        <li>Your channel lists, watch history, and personal settings.</li>
      </ul>

      <p className="mt-8">
        For full details on what Tubeo collects and why, see our{' '}
        <a className="text-emerald-600 underline" href="/privacy">
          Privacy Policy
        </a>
        .
      </p>
    </main>
  );
}
