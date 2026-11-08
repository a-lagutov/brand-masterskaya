import { getPayload } from 'payload';
import config from '../../../../../../../payload.config';
import { cabinetSecret } from '../../../../../../../cabinet/config';
import {
  cabinetSession,
  cabinetError,
  PRIVATE_HEADERS,
  sameOrigin,
} from '../../../../../../../cabinet/http';
import { playbackLecture } from '../../../../../../../cabinet/playback';
import { contentKeys } from '../../../../../../../cabinet/security';

/** Supplies a standard Clear Key JWK response; keys never appear in manifests or token payloads. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return cabinetError('Недопустимый запрос.', 403);
  const session = await cabinetSession();
  if (!session) return cabinetError('Войдите через Telegram.', 401);
  const payload = await getPayload({ config });
  const lecture = await playbackLecture(
    payload,
    session,
    Number((await context.params).id),
    request.headers.get('x-playback-token') || '',
  );
  if (!lecture?.revision) return cabinetError('Доступ к видео закрыт.', 403);
  const { key, keyId } = contentKeys(lecture.revision, cabinetSecret());
  const kid = Buffer.from(keyId, 'hex').toString('base64url');
  const bodyText = await request.text();
  if (bodyText.length > 4096) return cabinetError('Некорректная лицензия.', 400);
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return cabinetError('Некорректная лицензия.', 400);
  }
  if (
    !Array.isArray(body.kids) ||
    !body.kids.length ||
    body.kids.some((value: unknown) => value !== kid)
  )
    return cabinetError('Некорректная лицензия.', 400);
  return Response.json(
    {
      keys: [{ kty: 'oct', kid, k: Buffer.from(key, 'hex').toString('base64url') }],
      type: 'temporary',
    },
    { headers: PRIVATE_HEADERS },
  );
}
