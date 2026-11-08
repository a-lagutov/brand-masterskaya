import type { Payload, Where } from 'payload';
import type { Lecture } from '../payload-types';

/** Resolves manually assigned learning groups, independently of Telegram chat membership. */
export async function memberGroupIds(payload: Payload, memberId: number): Promise<number[]> {
  const groups = await payload.find({
    collection: 'learning-groups',
    where: { members: { contains: memberId } },
    pagination: false,
    depth: 0,
  });
  return groups.docs.map((group) => group.id);
}

/** Filters at the database boundary so inaccessible metadata is never serialized to students. */
export function lectureFilter(groupIds: number[]): Where {
  return {
    and: [
      { published: { equals: true } },
      { processingStatus: { equals: 'ready' } },
      { groups: { in: groupIds.length ? groupIds : [-1] } },
    ],
  };
}

/** Rechecks current groups for every manifest, segment and license request, including revocations. */
export async function authorizedLecture(
  payload: Payload,
  memberId: number,
  lectureId: number,
): Promise<Lecture | null> {
  const groups = await memberGroupIds(payload, memberId);
  if (!groups.length) return null;
  const result = await payload.find({
    collection: 'lectures',
    where: { and: [lectureFilter(groups), { id: { equals: lectureId } }] },
    limit: 1,
    depth: 0,
  });
  return result.docs[0] || null;
}
