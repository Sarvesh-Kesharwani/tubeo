import { getSession } from '@/lib/session';
import { DeepSeekConfigError, DeepSeekRequestError, summarizeTranscriptForCitizen } from '@/lib/deepseek';
import { TranscriptError, fetchYouTubeTranscript } from '@/lib/youtube-transcript';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) {
    return Response.json({ ok: false, error: 'Sign in required.' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return Response.json({ ok: false, error: 'Video ID missing.' }, { status: 400 });
  }

  try {
    const transcript = await fetchYouTubeTranscript(id);
    const bullets = await summarizeTranscriptForCitizen({ videoId: id, transcript });
    return Response.json({ ok: true, bullets });
  } catch (error) {
    if (error instanceof TranscriptError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof DeepSeekConfigError) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    if (error instanceof DeepSeekRequestError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }

    return Response.json(
      { ok: false, error: (error as Error).message || 'Could not summarize transcript.' },
      { status: 500 },
    );
  }
}
