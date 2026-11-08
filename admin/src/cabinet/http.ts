import { cookies } from 'next/headers';
import { getPayload } from 'payload';
import config from '../payload.config';
import { cabinetOrigin, cabinetSecret } from './config';
import { verifyToken, type CabinetToken } from './security';

export const SESSION_COOKIE = 'cabinet-session';
export const OAUTH_COOKIE = 'cabinet-oauth';
export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

/** Host-only HttpOnly cookies isolate student login from Payload admin authentication. */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: cabinetOrigin().startsWith('https:'),
    sameSite: 'lax' as const,
    path: '/cabinet',
    maxAge,
  };
}

/** Returns a verified login only while its member still exists. */
export async function cabinetSession(): Promise<CabinetToken | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const token = verifyToken(value, cabinetSecret(), 'session');
  if (!token || !Number.isSafeInteger(token.memberId) || !token.sessionId) return null;
  const payload = await getPayload({ config });
  const member = await payload
    .findByID({ collection: 'members', id: token.memberId!, depth: 0 })
    .catch(() => null);
  return member ? token : null;
}

/** Rejects cross-origin writes, including same-site requests from another subdomain. */
export function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === cabinetOrigin();
}

/** Serializes errors without exposing server configuration, paths, keys or upstream responses. */
export function cabinetError(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: PRIVATE_HEADERS });
}
