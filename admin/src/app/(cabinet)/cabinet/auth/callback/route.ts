import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { getPayload } from 'payload';
import config from '../../../../../payload.config';
import { findOrCreateMember } from '../../../../../bot/members';
import { cabinetOrigin, cabinetSecret } from '../../../../../cabinet/config';
import {
  cookieOptions,
  OAUTH_COOKIE,
  SESSION_COOKIE,
  PRIVATE_HEADERS,
  cabinetError,
} from '../../../../../cabinet/http';
import { signToken, verifyToken } from '../../../../../cabinet/security';
import { verifyTelegramIdentity } from '../../../../../cabinet/telegramLogin';

/** Exchanges a one-use authorization code and creates a separate student session. */
export async function GET(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  const flow = verifyToken(cookieStore.get(OAUTH_COOKIE)?.value || '', cabinetSecret(), 'oauth');
  cookieStore.set(OAUTH_COOKIE, '', cookieOptions(0));
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (
    !flow?.state ||
    !flow.verifier ||
    flow.state !== url.searchParams.get('state') ||
    !code ||
    code.length > 4096
  ) {
    return cabinetError('Не удалось подтвердить вход. Начните вход заново.', 400);
  }
  try {
    const clientId = process.env.TELEGRAM_LOGIN_CLIENT_ID || '';
    const response = await fetch('https://oauth.telegram.org/token', {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${process.env.TELEGRAM_LOGIN_CLIENT_SECRET || ''}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: `${cabinetOrigin()}/cabinet/auth/callback`,
        code_verifier: flow.verifier,
      }),
    });
    if (!response.ok) throw new Error('Token exchange rejected');
    const result = await response.json();
    if (typeof result.id_token !== 'string') throw new Error('Missing ID token');
    const identity = await verifyTelegramIdentity(result.id_token, clientId);
    const payload = await getPayload({ config });
    const member = await findOrCreateMember(payload, identity);
    cookieStore.set(
      SESSION_COOKIE,
      signToken(
        {
          purpose: 'session',
          memberId: member.id,
          sessionId: randomBytes(32).toString('base64url'),
        },
        cabinetSecret(),
        86400,
      ),
      cookieOptions(86400),
    );
    return new Response(null, {
      status: 303,
      headers: { ...PRIVATE_HEADERS, Location: `${cabinetOrigin()}/cabinet` },
    });
  } catch {
    // Never log authorization codes, tokens, profile claims or upstream response bodies.
    return cabinetError(
      'Не удалось войти через Telegram. Вернитесь в кабинет и повторите вход.',
      401,
    );
  }
}
