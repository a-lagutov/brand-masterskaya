import type { CollectionConfig } from 'payload';

/**
 * Plans and electives from the site's prices.json and the chats each of them opens.
 * The list itself follows the site; only the chats are edited here.
 */
export const Products: CollectionConfig = {
  slug: 'products',
  labels: { singular: 'Тариф или факультатив', plural: 'Тарифы и факультативы' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'kind', 'chats'],
    description:
      'Список берётся с сайта (src/prices.json). Здесь выберите, в какие чаты бот пускает купивших.',
  },
  access: {
    // Products come from the site; a manual one would match no order.
    create: () => false,
    delete: () => false,
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
      name: 'chats',
      type: 'relationship',
      relationTo: 'chats',
      hasMany: true,
      label: 'Открывает чаты',
    },
  ],
};
