import { createHmac, timingSafeEqual } from 'crypto';
import {
  appendInstagramInboxReels,
  extractInstagramReelUrlsFromPayload,
  extractInstagramSenderIdsFromPayload,
  sendInstagramMessage,
} from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!APP_SECRET) return true;
  if (!signature?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  const received = signature.slice('sha256='.length);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(received, 'hex');

  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export async function GET(req: Request) {
  if (!VERIFY_TOKEN) {
    return textResponse('Instagram webhook verify token is not configured.', 500);
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
    return textResponse(challenge);
  }

  return textResponse('Forbidden', 403);
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');

  if (!verifySignature(rawBody, signature)) {
    return Response.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const reelUrls = extractInstagramReelUrlsFromPayload(body);
  const result = await appendInstagramInboxReels(reelUrls);
  const senderIds = extractInstagramSenderIdsFromPayload(body);
  const replyText =
    reelUrls.length === 0
      ? 'Send or forward an Instagram reel link to save it in Tubeo.'
      : !result.persisted
        ? 'I found the reel, but Tubeo could not save it yet. Try again in a minute.'
        : result.added > 0
          ? 'Added to Tubeo.'
          : 'Already saved in Tubeo.';
  const replyResults = await Promise.allSettled(
    senderIds.map((senderId) => sendInstagramMessage(senderId, replyText)),
  );
  const repliesSent = replyResults.filter(
    (reply): reply is PromiseFulfilledResult<boolean> =>
      reply.status === 'fulfilled' && reply.value,
  ).length;

  console.info('instagram_webhook_received', {
    receivedAt: new Date().toISOString(),
    hasBody: Boolean(body),
    reelUrls: reelUrls.length,
    added: result.added,
    persisted: result.persisted,
    senderIds: senderIds.length,
    repliesSent,
  });

  return Response.json({
    ok: true,
    reels: reelUrls.length,
    added: result.added,
    total: result.total,
    persisted: result.persisted,
    repliesSent,
  });
}
