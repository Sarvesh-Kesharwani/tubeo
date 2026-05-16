import {
  getCookieViewPreferences,
  markCookieChannelStoreDirty,
  setCookieViewPreferences,
} from '@/lib/channels-cookie';
import { parseDurationFilter } from '@/lib/duration';
import { parseMediaFilter } from '@/lib/media';
import { parseRange } from '@/lib/time';
import { type ViewPreferences } from '@/lib/types';
import { normalizeViewPreferences, normalizeViewSpace, sameViewPreferences } from '@/lib/view-preferences';

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('Invalid request body');
  }

  const page = String(body.page ?? '').trim();
  if (page !== 'home' && page !== 'channels' && page !== 'updates') {
    return fail('Unsupported page');
  }

  const existing = await getCookieViewPreferences();
  const next: ViewPreferences = normalizeViewPreferences({
    ...existing,
    home:
      page === 'home'
        ? {
            range: parseRange(String(body.range ?? existing.home.range)),
            media: parseMediaFilter(String(body.media ?? existing.home.media)),
            duration: parseDurationFilter(String(body.duration ?? existing.home.duration)),
          }
        : existing.home,
    channels:
      page === 'channels'
        ? {
            range: parseRange(String(body.range ?? existing.channels.range)),
            media: parseMediaFilter(String(body.media ?? existing.channels.media)),
            duration: parseDurationFilter(String(body.duration ?? existing.channels.duration)),
            space: normalizeViewSpace(String(body.space ?? existing.channels.space)),
          }
        : existing.channels,
    updates:
      page === 'updates'
        ? {
            range: parseRange(String(body.range ?? existing.updates.range)),
            media: parseMediaFilter(String(body.media ?? existing.updates.media)),
            duration: parseDurationFilter(String(body.duration ?? existing.updates.duration)),
          }
        : existing.updates,
  });

  if (sameViewPreferences(existing, next)) {
    return Response.json({ ok: true, changed: false });
  }

  const updatedAt = new Date().toISOString();
  await setCookieViewPreferences(next, updatedAt);
  await markCookieChannelStoreDirty(updatedAt);
  return Response.json({ ok: true, changed: true, filters: next, updatedAt });
}
