import { createHmac } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_SECRET = process.env.META_APP_SECRET;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://tubeo-one.vercel.app';

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function parseSignedRequest(signed: string): { user_id?: string } | null {
  if (!APP_SECRET) return null;
  const [encodedSig, encodedPayload] = signed.split('.');
  if (!encodedSig || !encodedPayload) return null;

  const sig = base64UrlDecode(encodedSig);
  const expected = createHmac('sha256', APP_SECRET).update(encodedPayload).digest();
  if (sig.length !== expected.length || !sig.equals(expected)) return null;

  try {
    return JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get('signed_request')?.toString() ?? '';
  const parsed = parseSignedRequest(signed);
  const userId = parsed?.user_id ?? 'unknown';

  const confirmationCode = `del_${Date.now().toString(36)}_${userId.slice(-6)}`;

  console.info('meta_data_deletion_request', {
    receivedAt: new Date().toISOString(),
    userId,
    confirmationCode,
    parsed: Boolean(parsed),
  });

  return Response.json({
    url: `${SITE_URL}/account-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}

export function GET() {
  return Response.json({
    ok: true,
    info: 'POST a signed_request from Meta to trigger data deletion.',
  });
}
