import { getPayload } from 'payload';
import config from '../../../payload.config';
import { cabinetSession } from '../../../cabinet/http';
import { lectureFilter, memberGroupIds } from '../../../cabinet/access';
import { Cabinet } from './Cabinet';

export const dynamic = 'force-dynamic';

/** Lists only currently accessible recordings; private upload metadata stays on the server. */
export default async function CabinetPage() {
  const session = await cabinetSession();
  const payload = session ? await getPayload({ config }) : null;
  const member =
    payload && session
      ? await payload.findByID({ collection: 'members', id: session.memberId!, depth: 0 })
      : null;
  const groups = payload && member ? await memberGroupIds(payload, member.id) : [];
  const lectures =
    payload && groups.length
      ? (
          await payload.find({
            collection: 'lectures',
            where: lectureFilter(groups),
            sort: 'sortOrder',
            depth: 0,
            pagination: false,
          })
        ).docs
      : [];
  return (
    <Cabinet
      member={
        member ? { name: member.displayName || 'Участник', telegramId: member.telegramId } : null
      }
      lectures={lectures.map((lecture) => ({
        id: lecture.id,
        title: lecture.title,
        speaker: lecture.speaker || '',
        description: lecture.description || '',
      }))}
      loginConfigured={Boolean(
        process.env.TELEGRAM_LOGIN_CLIENT_ID &&
        process.env.TELEGRAM_LOGIN_CLIENT_SECRET &&
        process.env.CABINET_SECRET,
      )}
    />
  );
}
