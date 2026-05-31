import { NextResponse } from 'next/server';
import { saveNewsYouLearnPrompt } from '@/lib/news-youlearn-service';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

const MAX_PROMPT_CHARS = 8000;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail('Sign in to save prompt.', 401);

  let body: { prompt?: unknown; kind?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('Invalid JSON body.');
  }

  if (typeof body.prompt !== 'string') return fail('Prompt must be a string.');
  if (body.prompt.length > MAX_PROMPT_CHARS) return fail(`Prompt must be ${MAX_PROMPT_CHARS} characters or fewer.`);
  const kind = body.kind === 'analogy' ? 'analogy' : 'layered';

  try {
    const state = await saveNewsYouLearnPrompt(session, body.prompt, kind);
    const prompt = kind === 'analogy' ? state.analogyPrompt ?? '' : state.layeredPrompt || state.prompt;
    const updatedAt =
      kind === 'analogy'
        ? state.analogyPromptUpdatedAt ?? new Date().toISOString()
        : state.layeredPromptUpdatedAt ?? state.promptUpdatedAt ?? new Date().toISOString();
    return NextResponse.json({ ok: true, kind, prompt, updatedAt, state });
  } catch (error) {
    return fail((error as Error).message || 'Could not save prompt.', 502);
  }
}
