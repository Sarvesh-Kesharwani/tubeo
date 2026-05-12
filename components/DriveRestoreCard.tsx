'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface BackupSummary {
  name: string;
  date: string | null;
  type: 'daily' | 'snapshot';
}

interface BackupResponse {
  defaultDate: string;
  yesterday: string;
  target: BackupSummary | null;
  backups: BackupSummary[];
}

export function DriveRestoreCard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<BackupResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/drive/restore')
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as BackupResponse;
      })
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setData(null);
      });
    return () => {
      active = false;
    };
  }, []);

  function restoreYesterday() {
    if (!data?.defaultDate || !data.target) return;
    const confirmed = window.confirm(`Restore Tubeo data from ${data.defaultDate}? Current Drive data will be snapshotted first.`);
    if (!confirmed) return;

    setError(null);
    setMessage(null);
    startTransition(() => {
      void fetch('/api/drive/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: data.defaultDate }),
      })
        .then(async (response) => {
          const result = (await response.json().catch(() => null)) as
            | { error?: string; counts?: { channels: number; vocabs?: number } }
            | null;
          if (!response.ok || result?.error) {
            setError(result?.error ?? 'Restore failed.');
            return;
          }

          sessionStorage.removeItem('tubeo_drive_pulled');
          setMessage(`Restored ${result?.counts?.channels ?? 0} channels and ${result?.counts?.vocabs ?? 0} vocab entries.`);
          router.refresh();
        })
        .catch(() => setError('Restore failed.'));
    });
  }

  const targetBackup = data?.target ?? null;
  const isYesterday = !!data && data.defaultDate === data.yesterday;
  const buttonLabel = pending
    ? 'Restoring...'
    : targetBackup
      ? isYesterday
        ? 'Restore Yesterday'
        : `Restore ${data!.defaultDate}`
      : 'No backup available';

  return (
    <section className="card space-y-3 border-red-200 bg-red-50/60 p-5">
      <div className="space-y-1">
        <h2 className="font-extrabold text-duo-ink">Drive backup restore</h2>
        <p className="text-xs font-bold text-duo-ink/60">
          Restore your most recent Tubeo backup from Google Drive app data.
          Yesterday&apos;s backup is used when available.
        </p>
      </div>
      <div className="rounded-2xl border-2 border-red-100 bg-white px-3 py-2 text-xs font-bold text-duo-ink/60">
        {data ? (
          targetBackup ? (
            <span>
              {isYesterday
                ? `Found ${targetBackup.type} backup for ${data.defaultDate} (yesterday): ${targetBackup.name}`
                : `No backup for ${data.yesterday} (yesterday). Falling back to ${targetBackup.type} backup for ${data.defaultDate}: ${targetBackup.name}`}
            </span>
          ) : (
            <span>No Tubeo backups found in Drive yet.</span>
          )
        ) : (
          <span>Checking Drive backups...</span>
        )}
      </div>
      <button
        type="button"
        onClick={restoreYesterday}
        disabled={pending || !targetBackup}
        className="btn-duo bg-red-500 text-white shadow-red-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {buttonLabel}
      </button>
      {message && <p className="text-sm font-bold text-duo-greenDark">{message}</p>}
      {error && <p className="text-sm font-bold text-red-500">{error}</p>}
    </section>
  );
}
