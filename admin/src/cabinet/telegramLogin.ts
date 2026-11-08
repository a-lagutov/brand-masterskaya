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
  const userId =
    typeof payload.id === 'string' && /^[1-9]\d*$/.test(payload.id)
      ? Number(payload.id)
      : payload.id;
  if (!Number.isSafeInteger(userId) || Number(userId) <= 0) {
    throw Object.assign(new Error('Invalid Telegram identity'), {
      code:
        payload.id === undefined || payload.id === null
          ? 'ERR_TELEGRAM_ID_CLAIM_MISSING'
          : 'ERR_TELEGRAM_ID_CLAIM_FORMAT',
      claim: 'id',
    });
  }
  return {
    id: Number(userId),
    first_name: typeof payload.name === 'string' ? payload.name.slice(0, 200) : undefined,
    username:
      typeof payload.preferred_username === 'string'
        ? payload.preferred_username.slice(0, 64)
        : undefined,
  };
}
