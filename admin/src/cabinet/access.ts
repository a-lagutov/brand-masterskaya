import type { Payload, Where } from 'payload';
import { relationIds } from '../bot/relations';
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

/** Resolves purchased products without mixing paid and unpaid orders or including trashed orders. */
export async function memberProductIds(payload: Payload, memberId: number): Promise<number[]> {
  const orders = await payload.find({
    collection: 'orders',
    where: {
      and: [
        { member: { equals: memberId } },
        { paidAt: { exists: true } },
        { deletedAt: { exists: false } },
      ],
    },
    pagination: false,
    depth: 0,
  });
  // Some databases treat explicit null as existing; require an actual payment timestamp.
  return [
    ...new Set(
      orders.docs
        .filter((order) => Boolean(order.paidAt))
        .flatMap((order) => relationIds(order.products)),
    ),
  ];
}

/** Filters at the database boundary so inaccessible metadata is never serialized to students. */
export function lectureFilter(groupIds: number[], productIds: number[] = []): Where {
  return {
    and: [
      { published: { equals: true } },
      { processingStatus: { equals: 'ready' } },
      {
        or: [
          { groups: { in: groupIds.length ? groupIds : [-1] } },
          { products: { in: productIds.length ? productIds : [-1] } },
        ],
      },
    ],
  };
}

/** Rechecks current groups and purchases for every manifest, segment and license request, including revocations. */
export async function authorizedLecture(
  payload: Payload,
  memberId: number,
  lectureId: number,
): Promise<Lecture | null> {
  const [groups, products] = await Promise.all([
    memberGroupIds(payload, memberId),
    memberProductIds(payload, memberId),
  ]);
  if (!groups.length && !products.length) return null;
  const result = await payload.find({
    collection: 'lectures',
    where: { and: [lectureFilter(groups, products), { id: { equals: lectureId } }] },
    limit: 1,
    depth: 0,
  });
  return result.docs[0] || null;
}
