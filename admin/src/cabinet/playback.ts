import type { Payload } from 'payload';
import { authorizedLecture } from './access';
import { cabinetSecret } from './config';
import { playbackMatches, verifyToken, type CabinetToken } from './security';

/** Checks both the short-lived playback grant and live membership before reading media or keys. */
export async function playbackLecture(
  payload: Payload,
  session: CabinetToken,
  lectureId: number,
  tokenValue: string,
) {
  const token = verifyToken(tokenValue, cabinetSecret(), 'playback');
  if (!token || !Number.isSafeInteger(lectureId) || !session.memberId) return null;
  const lecture = await authorizedLecture(payload, session.memberId, lectureId);
  return lecture?.revision && playbackMatches(token, session, lectureId, lecture.revision)
    ? lecture
    : null;
}
