import type { Payload } from 'payload';

import type { Chat, Member } from '../payload-types';
import { paidOrders } from './members';
import { relationIds } from './relations';
import { telegramApi } from './telegram';

/**
 * Chats the member may enter: those opened by the products of their paid orders plus the
 * chats added by hand, minus the blocked ones. Only chats where the bot is an admin.
 * @param payload
 * @param member
 * @returns The chats, in the order of the products.
 */
export async function allowedChats(payload: Payload, member: Member): Promise<Chat[]> {
  const orders = await paidOrders(payload, member.id);
  const productIds = [...new Set(orders.flatMap((order) => relationIds(order.products)))];
  const products = productIds.length
    ? (
        await payload.find({
          collection: 'products',
          where: { id: { in: productIds } },
          limit: 100,
          depth: 0,
        })
      ).docs
    : [];
  const blocked = new Set(relationIds(member.blockedChats));
  const chatIds = [
    ...new Set([
      ...products.flatMap((product) => relationIds(product.chats)),
      ...relationIds(member.extraChats),
    ]),
  ].filter((chatId) => !blocked.has(chatId));
  if (!chatIds.length) {
    return [];
  }
  const chats = (
    await payload.find({
      collection: 'chats',
      where: { id: { in: chatIds }, botStatus: { equals: 'administrator' } },
      limit: 100,
      depth: 0,
    })
  ).docs;
  return chatIds
    .map((chatId) => chats.find((chat) => chat.id === chatId))
    .filter((chat): chat is Chat => !!chat);
}

/**
 * Join links for the member's chats, created once per chat and kept on the member. The links
 * create join requests, so a forwarded link lets nobody else in.
 * @param payload
 * @param member
 * @returns Button title and link per chat; chats where the link failed are skipped.
 */
export async function inviteButtons(
  payload: Payload,
  member: Member,
): Promise<{ title: string; url: string }[]> {
  const api = telegramApi();
  if (!api) {
    return [];
  }
  const links = { ...((member.inviteLinks as Record<string, string> | null) ?? {}) };
  const buttons: { title: string; url: string }[] = [];
  for (const chat of await allowedChats(payload, member)) {
    if (!links[chat.telegramId]) {
      try {
        const invite = await api.createChatInviteLink(chat.telegramId, {
          // Telegram limits the name to 32 characters.
          name: `Участник ${member.telegramId}`.slice(0, 32),
          creates_join_request: true,
        });
        links[chat.telegramId] = invite.invite_link;
      } catch (error) {
        // Usually the bot lost the admin rights or the "invite users" right.
        payload.logger.error({ err: error, chat: chat.telegramId }, 'bot: invite link failed');
        continue;
      }
    }
    buttons.push({ title: chat.title, url: links[chat.telegramId] });
  }
  if (JSON.stringify(links) !== JSON.stringify(member.inviteLinks ?? {})) {
    await payload.update({
      collection: 'members',
      id: member.id,
      data: { inviteLinks: links },
      depth: 0,
    });
  }
  return buttons;
}

/**
 * Removes a Telegram user from a chat; a ban lifted at once is Telegram's way to kick.
 * @param payload
 * @param chatId The chat's id in the panel.
 * @param telegramUserId
 */
export async function removeFromChat(
  payload: Payload,
  chatId: number,
  telegramUserId: string,
): Promise<void> {
  const api = telegramApi();
  if (!api) {
    return;
  }
  const chat = await payload.findByID({ collection: 'chats', id: chatId, depth: 0 });
  try {
    await api.banChatMember(chat.telegramId, Number(telegramUserId));
    await api.unbanChatMember(chat.telegramId, Number(telegramUserId), { only_if_banned: true });
  } catch (error) {
    payload.logger.error({ err: error, chat: chat.telegramId }, 'bot: kick failed');
  }
}
