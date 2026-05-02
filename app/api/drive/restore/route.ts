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
} from '@/lib/drive';
import { getSession } from '@/lib/session';
import { getEnvChannelIds } from '@/lib/whitelist';

export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const backups = await listDriveBackups(session.accessToken);
  return Response.json({
    ok: true,
    defaultDate: getPreviousBackupDate(),
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

  const date = body.date?.trim() || getPreviousBackupDate();
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
    savedVideos: restored.savedVideos,
  });
  await markCookieChannelStoreSynced(restoredAt);
  await markDriveSyncHydrated();

  revalidatePath('/');
  revalidatePath('/channels');
  revalidatePath('/settings');
  revalidatePath('/updates');
  revalidatePath('/videos');

  return Response.json({
    ok: true,
    date,
    restoredAt,
    backup: restored.backup,
    counts: {
      channels: restored.channels.length,
      spaces: restored.spaces.length,
      savedVideos: restored.savedVideos.length,
      updatesChannelIds: restored.updatesChannelIds.length,
    },
  });
}
