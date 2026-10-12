import type { Payload } from 'payload';

import type { Member, Order } from '../payload-types';

/** The Telegram user fields the bot keeps. */
type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };

/**
 * The member for a Telegram account, created on first contact; the name and @username are
 * refreshed when they change.
 * @param payload
 * @param user Telegram user; only the id is known for accounts bound by the earlier PHP bot.
 * @returns The member.
 */
export async function findOrCreateMember(payload: Payload, user: TelegramUser): Promise<Member> {
  const telegramId = String(user.id);
  const existing = await payload.find({
    collection: 'members',
    where: { telegramId: { equals: telegramId } },
    limit: 1,
    depth: 0,
  });
  const profile = user.first_name
    ? {
        displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
        username: user.username ?? '',
      }
    : {};
  const member = existing.docs[0];
  if (!member) {
    return payload.create({
      collection: 'members',
      data: {
        telegramId,
        displayName: profile.displayName ?? telegramId,
        username: profile.username ?? '',
      },
      depth: 0,
    });
  }
  const changed =
    profile.displayName !== undefined &&
    (member.displayName !== profile.displayName || member.username !== profile.username);
  return changed
    ? payload.update({ collection: 'members', id: member.id, data: profile, depth: 0 })
    : member;
}

/**
 * Paid orders bound to the member.
 * @param payload
 * @param memberId
 */
export async function paidOrders(payload: Payload, memberId: number): Promise<Order[]> {
  const result = await payload.find({
    collection: 'orders',
    where: { member: { equals: memberId }, paidAt: { exists: true } },
    sort: 'createdOnSite',
    limit: 100,
    depth: 0,
  });
  // exists also matches an explicit null on some databases.
  return result.docs.filter((order) => Boolean(order.paidAt));
}
