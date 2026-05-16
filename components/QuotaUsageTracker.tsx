'use client';

import { useEffect } from 'react';

interface Props {
  units: number;
  trackingKey: string;
  label: string;
}

export function QuotaUsageTracker({ units, trackingKey, label }: Props) {
  useEffect(() => {
    if (units <= 0) return;

    const sessionKey = `tubeo-quota-${trackingKey}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');

    void fetch('/api/quota/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units, label, kind: 'youtube' }),
    })
      .then((response) => {
        if (response.ok) window.dispatchEvent(new CustomEvent('tubeo-quota-updated'));
      })
      .catch(() => {
        sessionStorage.removeItem(sessionKey);
      });
  }, [label, trackingKey, units]);

  return null;
}
