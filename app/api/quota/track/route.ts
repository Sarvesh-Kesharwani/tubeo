import { getCookieChannelStore } from '@/lib/channels-cookie';
import { normalizeQuotaUsage } from '@/lib/drive';
import { getSession } from '@/lib/session';
import { readUserSyncState, writeUserSyncState } from '@/lib/sync-store';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: { units?: number } | null = null;
  try {
    body = (await req.json()) as { units?: number };
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const units = Math.max(0, Math.ceil(Number(body?.units ?? 0)));
  if (!Number.isFinite(units) || units <= 0) {
    return Response.json({ ok: true, skipped: true });
  }

  try {
    const [cookieStore, remote] = await Promise.all([
      getCookieChannelStore(),
      readUserSyncState(session),
    ]);
    const base = remote.state ?? cookieStore;
    const quota = normalizeQuotaUsage(remote.state?.quota);
    await writeUserSyncState(session, {
      channels: base.channels,
      spaces: base.spaces,
      view: base.view,
      viewUpdatedAt: base.viewUpdatedAt,
      updatesChannelIds: base.updatesChannelIds,
      vocabs: base.vocabs,
      ignoredChannels: base.ignoredChannels,
      discoverSearches: base.discoverSearches,
      activeDiscoverSearchId: base.activeDiscoverSearchId,
      quota: {
        ...quota,
        used: quota.used + units,
        updatedAt: new Date().toISOString(),
      },
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Failed to track quota usage' }, { status: 502 });
  }
}
