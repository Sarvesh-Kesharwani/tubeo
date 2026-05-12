import { cookies } from 'next/headers';
import { clearCookieChannelIds } from '@/lib/channels-cookie';

const TRANSIENT_AUTH_COOKIES = [
  'authjs.pkce.code_verifier',
  '__Secure-authjs.pkce.code_verifier',
  'authjs.state',
  '__Secure-authjs.state',
  'authjs.nonce',
  '__Secure-authjs.nonce',
];

export async function POST(req: Request) {
  const jar = await cookies();
  let clearAppState = false;

  try {
    const body = (await req.json()) as { clearAppState?: boolean };
    clearAppState = body.clearAppState === true;
  } catch {
    clearAppState = false;
  }

  for (const name of TRANSIENT_AUTH_COOKIES) {
    jar.delete(name);
  }

  if (clearAppState) {
    await clearCookieChannelIds();
  }

  return Response.json({ ok: true });
}
