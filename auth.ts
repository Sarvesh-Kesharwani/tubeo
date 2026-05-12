import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { verifyHubTokenViaHub } from '@/lib/hub-sso';

async function refreshGoogleToken(token: Record<string, unknown>) {
  const refreshToken = token.refreshToken as string | undefined;
  if (!refreshToken) return token;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return { ...token, accessTokenError: 'RefreshAccessTokenError' };
  }

  return {
    ...token,
    accessToken: data.access_token,
    accessTokenExpires: Math.floor(Date.now() / 1000) + Number(data.expires_in ?? 3600),
    refreshToken: data.refresh_token ?? refreshToken,
    accessTokenError: undefined,
  };
}

const isProd = process.env.NODE_ENV === 'production';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  cookies: {
    sessionToken: {
      name: isProd ? '__Secure-authjs.session-token' : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: isProd ? 'none' : 'lax',
        secure: isProd,
        path: '/',
        ...(isProd ? { partitioned: true } : {}),
      },
    },
  },
  providers: [
    Credentials({
      id: 'hub-sso',
      name: 'Hub SSO',
      credentials: { token: { type: 'text' } },
      async authorize(credentials) {
        const token = typeof credentials?.token === 'string' ? credentials.token : '';
        if (!token) return null;
        const result = await verifyHubTokenViaHub(token);
        if (!result.ok || !result.sub) return null;
        return {
          id: result.sub,
          email: result.email ?? result.sub,
          name: result.email ?? result.sub,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            // Drive appdata = hidden app folder in user's Drive, perfect for storing preferences
            'https://www.googleapis.com/auth/drive.appdata',
          ].join(' '),
          access_type: 'offline', // get refresh_token
          prompt: 'consent',       // always show consent to ensure refresh_token is returned
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // On first sign-in, persist Google tokens into JWT
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.accessTokenExpires = account.expires_at;
        token.accessTokenError = undefined;
      }

      const expiresAt = Number(token.accessTokenExpires ?? 0) * 1000;
      if (token.accessToken && Date.now() < expiresAt - 60_000) {
        return token;
      }

      if (token.refreshToken) {
        return refreshGoogleToken(token);
      }

      return token;
    },
    async session({ session, token }) {
      // Expose tokens to server-side session so Drive API can use them
      session.accessToken = token.accessToken as string | undefined;
      return session;
    },
  },
});
