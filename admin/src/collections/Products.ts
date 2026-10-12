import type { CollectionConfig } from 'payload';

import { writePriceOverrides } from '../bot/prices';

/**
 * Plans and electives from the site's prices.json, their prices and the chats each of them
 * opens. The list itself follows the site; prices and chats are edited here.
 */
export const Products: CollectionConfig = {
  slug: 'products',
  labels: { singular: 'Тариф или факультатив', plural: 'Тарифы и факультативы' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'kind', 'chats'],
    description:
      'Список берётся с сайта. Здесь меняются цены (на сайте и в оплате — сразу после сохранения) ' +
      'и чаты, в которые бот пускает купивших.',
  },
  access: {
    // Products come from the site; a manual one would match no order.
    create: () => false,
    delete: () => false,
  },
  hooks: {
    afterChange: [({ req }) => writePriceOverrides(req.payload)],
  },
  fields: [
    {
      name: 'key',
      type: 'text',
      label: 'Ключ на сайте',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      name: 'title',
      type: 'text',
      label: 'Название',
      required: true,
      admin: { readOnly: true },
    },
    {
      name: 'kind',
      type: 'select',
      label: 'Тип',
      options: [
        { label: 'Тариф', value: 'plan' },
        { label: 'Факультатив', value: 'elective' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'price',
      type: 'number',
      label: 'Цена, ₽',
      min: 1,
      admin: {
        step: 1,
        description: 'Пусто — цена из файла сайта.',
      },
    },
    {
      name: 'chats',
      type: 'relationship',
      relationTo: 'chats',
      hasMany: true,
      label: 'Открывает чаты',
    },
  ],
};
