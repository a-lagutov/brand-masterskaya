import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

const TELEGRAM_KEYS = createRemoteJWKSet(
  new URL('https://oauth.telegram.org/.well-known/jwks.json'),
);

/** Verifies Telegram's signature, issuer, audience and time claims before mapping its numeric bot ID. */
export async function verifyTelegramIdentity(
  token: string,
  clientId: string,
  keys: JWTVerifyGetKey = TELEGRAM_KEYS,
) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: 'https://oauth.telegram.org',
    audience: clientId,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub'],
    maxTokenAge: '10m',
  });
  // OIDC sub is not the Telegram Bot API ID. The verified profile's id is the binding identity.
  if (!Number.isSafeInteger(payload.id) || Number(payload.id) <= 0)
    throw Object.assign(new Error('Invalid Telegram identity'), {
      code: 'ERR_TELEGRAM_ID_CLAIM',
      claim: 'id',
    });
  return {
    id: Number(payload.id),
    first_name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : undefined,
    username:
      typeof payload.preferred_username === 'string'
        ? payload.preferred_username.slice(0, 64)
        : undefined,
  };
}
