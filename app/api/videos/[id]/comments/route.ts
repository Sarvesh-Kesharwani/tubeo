import { getVideoComments } from '@/lib/youtube';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return Response.json({ ok: false, error: 'Video ID missing' }, { status: 400 });
  }

  try {
    const comments = await getVideoComments(id);
    return Response.json({ ok: true, comments });
  } catch (error) {
    return Response.json(
      { ok: false, error: (error as Error).message || 'Could not load comments' },
      { status: 500 },
    );
  }
}
