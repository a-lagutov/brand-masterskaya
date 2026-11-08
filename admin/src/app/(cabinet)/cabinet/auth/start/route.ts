import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { cabinetOrigin, cabinetSecret } from '../../../../../cabinet/config';
import {
  cookieOptions,
  OAUTH_COOKIE,
  PRIVATE_HEADERS,
  cabinetError,
} from '../../../../../cabinet/http';
import { signToken } from '../../../../../cabinet/security';

/** Begins Telegram OIDC with browser-bound state and PKCE, without exposing the client secret. */
export async function GET(): Promise<Response> {
  if (
    !process.env.TELEGRAM_LOGIN_CLIENT_ID ||
    !process.env.TELEGRAM_LOGIN_CLIENT_SECRET ||
    !process.env.CABINET_SECRET
  ) {
    return cabinetError('Вход пока не настроен. Обратитесь к организаторам.', 503);
  }
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  (await cookies()).set(
    OAUTH_COOKIE,
    signToken({ purpose: 'oauth', state, verifier }, cabinetSecret(), 600),
    cookieOptions(600),
  );
  const target = new URL('https://oauth.telegram.org/auth');
  target.search = new URLSearchParams({
    client_id: process.env.TELEGRAM_LOGIN_CLIENT_ID,
    redirect_uri: `${cabinetOrigin()}/cabinet/auth/callback`,
    response_type: 'code',
    scope: 'openid profile',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return new Response(null, {
    status: 302,
    headers: { ...PRIVATE_HEADERS, Location: target.href },
  });
}
