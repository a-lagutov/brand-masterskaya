import type { CollectionConfig } from 'payload';

/**
 * Telegram chats of the program. The bot adds a chat here by itself once it becomes an
 * admin there, and keeps its status and id up to date.
 */
export const Chats: CollectionConfig = {
  slug: 'chats',
  labels: { singular: 'Чат', plural: 'Чаты' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'botStatus', 'canInvite', 'telegramId'],
    description:
      'Добавьте бота в чат администратором с правом «Пригласительные ссылки» — чат появится здесь сам. ' +
      'Какие чаты открывает каждый тариф, задаётся в разделе «Тарифы и факультативы».',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Название на кнопке',
      required: true,
    },
    {
      name: 'telegramId',
      type: 'text',
      label: 'id чата в Telegram',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      name: 'telegramTitle',
      type: 'text',
      label: 'Название в Telegram',
      admin: { readOnly: true },
    },
    {
      name: 'botStatus',
      type: 'select',
      label: 'Бот в чате',
      options: [
        { label: 'Администратор', value: 'administrator' },
        { label: 'Участник без прав', value: 'member' },
        { label: 'Удалён из чата', value: 'left' },
      ],
      admin: {
        readOnly: true,
        description: 'Пускать людей бот может, только если он администратор.',
      },
    },
    {
      name: 'canInvite',
      type: 'checkbox',
      label: 'Право «Пригласительные ссылки»',
      admin: { readOnly: true },
    },
  ],
};
