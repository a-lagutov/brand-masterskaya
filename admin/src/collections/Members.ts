import type { CollectionAfterChangeHook, CollectionConfig } from 'payload';

import { removeFromChat } from '../bot/access';
import { relationIds } from '../bot/relations';

/**
 * Removes the member from chats newly added to "blocked chats", so the block works at once
 * and not only for the next join request.
 */
const kickFromBlockedChats: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  const wasBlocked = new Set(relationIds(previousDoc?.blockedChats));
  const newlyBlocked = relationIds(doc.blockedChats).filter((chatId) => !wasBlocked.has(chatId));
  for (const chatId of newlyBlocked) {
    await removeFromChat(req.payload, chatId, doc.telegramId);
  }
  return doc;
};

/** Telegram accounts that opened the bot, with their orders and manual access changes. */
export const Members: CollectionConfig = {
  slug: 'members',
  labels: { singular: 'Участник', plural: 'Участники' },
  admin: {
    useAsTitle: 'displayName',
    defaultColumns: ['displayName', 'username', 'orders', 'extraChats', 'blockedChats'],
    listSearchableFields: ['displayName', 'username', 'telegramId'],
    description:
      'Все, кто писал боту. Доступ в чаты даёт оплаченный заказ; здесь его можно дополнить или закрыть вручную.',
  },
  access: {
    // Members appear when they write to the bot.
    create: () => false,
  },
  hooks: {
    afterChange: [kickFromBlockedChats],
  },
  fields: [
    {
      name: 'displayName',
      type: 'text',
      label: 'Имя в Telegram',
      admin: { readOnly: true },
    },
    {
      type: 'row',
      fields: [
        { name: 'username', type: 'text', label: '@username', admin: { readOnly: true } },
        {
          name: 'telegramId',
          type: 'text',
          label: 'id в Telegram',
          required: true,
          unique: true,
          index: true,
          admin: { readOnly: true },
        },
      ],
    },
    {
      name: 'orders',
      type: 'join',
      collection: 'orders',
      on: 'member',
      label: 'Заказы',
    },
    {
      name: 'extraChats',
      type: 'relationship',
      relationTo: 'chats',
      hasMany: true,
      label: 'Дополнительно пустить в чаты',
      admin: {
        description:
          'Бот пустит в эти чаты, даже если в заказах их нет. Кнопки появятся по /start.',
      },
    },
    {
      name: 'blockedChats',
      type: 'relationship',
      relationTo: 'chats',
      hasMany: true,
      label: 'Не пускать в чаты',
      admin: {
        description: 'Бот удалит участника из этих чатов и не пустит обратно, даже по заказу.',
      },
    },
    {
      name: 'inviteLinks',
      type: 'json',
      label: 'Выданные ссылки',
      admin: {
        readOnly: true,
        description: 'Ссылки на вступление, которые бот создал для этого участника.',
      },
    },
  ],
};
