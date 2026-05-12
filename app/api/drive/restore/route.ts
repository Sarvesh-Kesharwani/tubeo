import { revalidatePath } from 'next/cache';
import {
  markCookieChannelStoreSynced,
  markDriveSyncHydrated,
  setCookieChannelStore,
} from '@/lib/channels-cookie';
import {
  getPreviousBackupDate,
  listDriveBackups,
  restoreDriveBackup,
  type DriveBackupSummary,
} from '@/lib/drive';
import { getSession } from '@/lib/session';
import { getEnvChannelIds } from '@/lib/whitelist';

function pickBestBackup(
  backups: DriveBackupSummary[],
  yesterday: string,
): DriveBackupSummary | null {
  const exact = backups.find((backup) => backup.date === yesterday);
  if (exact) return exact;

  const dated = backups
    .filter((backup) => backup.date)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (dated[0]) return dated[0];

  return backups[0] ?? null;
}

export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const backups = await listDriveBackups(session.accessToken);
  const yesterday = getPreviousBackupDate();
  const target = pickBestBackup(backups, yesterday);
  const defaultDate = target?.date ?? yesterday;

  return Response.json({
    ok: true,
    defaultDate,
    yesterday,
    target,
    backups,
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: { date?: string } = {};
  try {
    body = (await req.json()) as { date?: string };
  } catch {
    body = {};
  }

  let date = body.date?.trim();
  if (!date) {
    const backups = await listDriveBackups(session.accessToken);
    const fallback = pickBestBackup(backups, getPreviousBackupDate());
    date = fallback?.date ?? getPreviousBackupDate();
  }

  const restored = await restoreDriveBackup(session.accessToken, date);
  if (!restored) {
    return Response.json({ error: `No Tubeo backup found for ${date}.` }, { status: 404 });
  }

  const envIds = getEnvChannelIds();
  const restoredAt = new Date().toISOString();
  await setCookieChannelStore({
    channels: restored.channels.filter((channel) => !envIds.includes(channel.id)),
    spaces: restored.spaces,
    view: restored.view,
    viewUpdatedAt: restored.viewUpdatedAt,
    updatesChannelIds: restored.updatesChannelIds,
    vocabs: restored.vocabs,
  });
  await markCookieChannelStoreSynced(restoredAt);
  await markDriveSyncHydrated();

  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
  revalidatePath('/updates');
  revalidatePath('/vocab');

  return Response.json({
    ok: true,
    date,
    restoredAt,
    backup: restored.backup,
    counts: {
      channels: restored.channels.length,
      spaces: restored.spaces.length,
      vocabs: restored.vocabs.length,
      updatesChannelIds: restored.updatesChannelIds.length,
    },
  });
}
