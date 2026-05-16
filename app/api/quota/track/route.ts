import { readApiUsageSummaries, recordApiUsage } from '@/lib/api-usage';
import { getSession } from '@/lib/session';
import type { ApiUsageKind } from '@/lib/types';

export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  return Response.json({ ok: true, ...(await readApiUsageSummaries()) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let body: { units?: number; label?: string; kind?: ApiUsageKind } | null = null;
  try {
    body = (await req.json()) as { units?: number };
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const units = Math.max(0, Math.ceil(Number(body?.units ?? 0)));
  if (!Number.isFinite(units) || units <= 0) {
    return Response.json({ ok: true, skipped: true });
  }
  const kind: ApiUsageKind = body?.kind === 'deepseek' ? 'deepseek' : 'youtube';
  const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : 'Tubeo operation';

  try {
    await recordApiUsage(kind, label, units);
    return Response.json({ ok: true, ...(await readApiUsageSummaries()) });
  } catch {
    return Response.json({ error: 'Failed to track quota usage' }, { status: 502 });
  }
}
