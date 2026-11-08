import { cookies } from 'next/headers';
import { cabinetOrigin } from '../../../../../cabinet/config';
import {
  cookieOptions,
  SESSION_COOKIE,
  OAUTH_COOKIE,
  PRIVATE_HEADERS,
  sameOrigin,
  cabinetError,
} from '../../../../../cabinet/http';

/** Removes this browser's session; playback URLs also require the matching session cookie. */
export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return cabinetError('Недопустимый запрос.', 403);
  const cookieStore = await cookies();
  for (const name of [SESSION_COOKIE, OAUTH_COOKIE]) cookieStore.set(name, '', cookieOptions(0));
  return new Response(null, {
    status: 303,
    headers: { ...PRIVATE_HEADERS, Location: `${cabinetOrigin()}/cabinet` },
  });
}
