import { deleteLinkNestSavedLink } from '@/lib/linknest-import';

export async function DELETE(req: Request) {
  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const url = String(body.url ?? '').trim();
  if (!url) {
    return Response.json({ ok: false, error: 'Missing URL' }, { status: 400 });
  }

  try {
    const result = await deleteLinkNestSavedLink(url);
    return Response.json({ ok: true, deleted: result.deleted });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to remove LinkNest row.',
      },
      { status: 500 },
    );
  }
}
