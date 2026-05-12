export interface HubVerifyResult {
  ok: boolean;
  sub?: string;
  email?: string | null;
  appId?: string;
  exp?: number;
}

export async function verifyHubTokenViaHub(token: string): Promise<HubVerifyResult> {
  const hubOrigin = process.env.HUB_ORIGIN;
  if (!hubOrigin) return { ok: false };

  try {
    const res = await fetch(`${hubOrigin}/api/hub/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: process.env.NEXTAUTH_URL || process.env.AUTH_URL || '',
      },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as HubVerifyResult;
  } catch {
    return { ok: false };
  }
}
