import { getSession } from '@/lib/session';
import {
  isSupabaseNewsConfigured,
  readNewsState,
  writeNewsPrompt,
} from '@/lib/supabase-news';
import { getTubeoUserIdentity } from '@/lib/supabase-sync';

export const dynamic = 'force-dynamic';

const MAX_PROMPT_CHARS = 8000;

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function GET() {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) return fail('Not authenticated', 401);
  if (!isSupabaseNewsConfigured()) return fail('News sync is not configured', 503);

  const state = await readNewsState(identity);
  return Response.json({
    ok: true,
    prompt: state?.prompt ?? '',
    updatedAt: state?.updatedAt ?? null,
  });
}

export async function PUT(req: Request) {
  const session = await getSession();
  const identity = getTubeoUserIdentity(session);
  if (!identity) return fail('Not authenticated', 401);
  if (!isSupabaseNewsConfigured()) return fail('News sync is not configured', 503);

  let body: { prompt?: unknown };
  try {
    body = (await req.json()) as { prompt?: unknown };
  } catch {
    return fail('Invalid request body');
  }

  if (typeof body.prompt !== 'string') return fail('Prompt must be a string');
  if (body.prompt.length > MAX_PROMPT_CHARS) return fail(`Prompt must be ${MAX_PROMPT_CHARS} characters or fewer`);

  try {
    const payload = await writeNewsPrompt(identity, body.prompt);
    return Response.json({
      ok: true,
      prompt: payload.prompt,
      updatedAt: payload.updatedAt,
    });
  } catch (error) {
    return fail((error as Error).message, 502);
  }
}
