import type { Access, Payload, Where } from 'payload';
import { relationIds } from '../bot/relations';
import type { Lecture } from '../payload-types';

/** Student cookies never authenticate to Payload; only administrators manage lecture uploads. */
export const cabinetAdmin: Access = ({ req }) => req.user?.collection === 'users';

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
export function lectureFilter(productIds: number[]): Where {
  return {
    and: [
      { published: { equals: true } },
      { processingStatus: { equals: 'ready' } },
      { products: { in: productIds.length ? productIds : [-1] } },
    ],
  };
}

/** Rechecks current purchases for every manifest, segment and license request, including revocations. */
export async function authorizedLecture(
  payload: Payload,
  memberId: number,
  lectureId: number,
): Promise<Lecture | null> {
  const products = await memberProductIds(payload, memberId);
  if (!products.length) return null;
  const result = await payload.find({
    collection: 'lectures',
    where: { and: [lectureFilter(products), { id: { equals: lectureId } }] },
    limit: 1,
    depth: 0,
  });
  return result.docs[0] || null;
}
