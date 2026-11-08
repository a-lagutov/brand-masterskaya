import { getPayload } from 'payload';
import config from '../../../../../../../payload.config';
import { authorizedLecture } from '../../../../../../../cabinet/access';
import { cabinetSecret } from '../../../../../../../cabinet/config';
import {
  cabinetSession,
  cabinetError,
  PRIVATE_HEADERS,
  sameOrigin,
} from '../../../../../../../cabinet/http';
import { signToken } from '../../../../../../../cabinet/security';

/** Issues renewable ten-minute grants only for currently published and accessible lectures. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return cabinetError('Недопустимый запрос.', 403);
  const session = await cabinetSession();
  if (!session) return cabinetError('Войдите через Telegram.', 401);
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return cabinetError('Лекция не найдена.', 404);
  const payload = await getPayload({ config });
  const lecture = await authorizedLecture(payload, session.memberId!, id);
  if (!lecture?.revision) return cabinetError('Лекция недоступна.', 403);
  const token = signToken(
    {
      purpose: 'playback',
      memberId: session.memberId,
      sessionId: session.sessionId,
      lectureId: id,
      revision: lecture.revision,
    },
    cabinetSecret(),
    600,
  );
  return Response.json(
    {
      token,
      manifest: `/cabinet/media/${id}/manifest.mpd`,
      license: `/cabinet/api/lectures/${id}/license`,
    },
    { headers: PRIVATE_HEADERS },
  );
}
