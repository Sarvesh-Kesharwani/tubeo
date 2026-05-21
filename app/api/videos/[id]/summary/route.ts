import { getSession } from '@/lib/session';
import { recordApiUsage } from '@/lib/api-usage';
import { DeepSeekConfigError, DeepSeekRequestError, summarizeTranscriptForCitizen } from '@/lib/deepseek';
import { TranscriptError, fetchYouTubeTranscript } from '@/lib/youtube-transcript';
import { getVideoSummaryFallbackContext } from '@/lib/youtube';

function isBotCheckTranscriptError(error: TranscriptError): boolean {
  return /bot|sign in|login_required|confirm/i.test(error.message);
}

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
    let transcript: string;
    let usedFallback = false;
    try {
      transcript = await fetchYouTubeTranscript(id);
    } catch (error) {
      if (!(error instanceof TranscriptError) || !isBotCheckTranscriptError(error)) {
        throw error;
      }

      const fallback = await getVideoSummaryFallbackContext(id);
      if (!fallback?.text) throw new TranscriptError('YouTube blocked transcript fetch for this video.', 429);
      transcript = fallback.text;
      usedFallback = true;
      await recordApiUsage('youtube', `Video summary metadata fallback: ${id}`, fallback.quotaUnits);
    }

    const bullets = await summarizeTranscriptForCitizen({ videoId: id, transcript });
    return Response.json({
      ok: true,
      bullets,
      warning: usedFallback
        ? 'Transcript was blocked by YouTube, so this summary uses public title/description metadata.'
        : undefined,
    });
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
