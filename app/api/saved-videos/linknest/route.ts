import { removeLinkNestSavedLink } from '@/lib/linknest-import';

export async function DELETE(req: Request) {
  let body: { linkNestId?: string; url?: string };
  try {
    body = (await req.json()) as { linkNestId?: string; url?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const linkNestId = String(body.linkNestId ?? '').trim();
  const url = String(body.url ?? '').trim();
  if (!linkNestId && !url) {
    return Response.json({ ok: false, error: 'Missing LinkNest id or URL' }, { status: 400 });
  }

  try {
    const result = await removeLinkNestSavedLink({ linkNestId, rawUrl: url });
    return Response.json({ ok: true, deleted: result.deleted, archived: result.archived });
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
