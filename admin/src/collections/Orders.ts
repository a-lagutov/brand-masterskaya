import type { CollectionConfig } from 'payload';

/**
 * Orders from the site, copied here by the bot every minute (src/bot/orders.ts).
 * The site stays the source of truth; only the Telegram account binding is edited here.
 */
export const Orders: CollectionConfig = {
  slug: 'orders',
  labels: { singular: 'Заказ', plural: 'Заказы' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'products', 'total', 'paidAt', 'member'],
    listSearchableFields: ['name', 'email', 'phone', 'telegram', 'orderId'],
    description:
      'Заказы с сайта, обновляются раз в минуту. Чтобы человек мог заново привязать заказ ' +
      'к другому аккаунту Telegram, очистите поле «Аккаунт Telegram».',
  },
  defaultSort: '-createdOnSite',
  access: {
    // Orders come only from the site.
    create: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'name', type: 'text', label: 'Имя', admin: { readOnly: true } },
    {
      type: 'row',
      fields: [
        { name: 'email', type: 'email', label: 'Email', admin: { readOnly: true } },
        { name: 'phone', type: 'text', label: 'Телефон', admin: { readOnly: true } },
        {
          name: 'telegram',
          type: 'text',
          label: 'Telegram из формы',
          admin: { readOnly: true },
        },
      ],
    },
    {
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Тариф и факультативы',
      admin: { readOnly: true },
    },
    {
      name: 'items',
      type: 'array',
      label: 'Позиции',
      admin: { readOnly: true, initCollapsed: true },
      fields: [
        { name: 'title', type: 'text', label: 'Название' },
        { name: 'price', type: 'number', label: 'Цена, ₽' },
      ],
    },
    { name: 'total', type: 'number', label: 'Сумма, ₽', admin: { readOnly: true } },
    {
      type: 'row',
      fields: [
        {
          name: 'createdOnSite',
          type: 'date',
          label: 'Создан',
          admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } },
        },
        {
          name: 'paidAt',
          type: 'date',
          label: 'Оплачен',
          admin: {
            readOnly: true,
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Пусто — оплата не прошла.',
          },
        },
      ],
    },
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'members',
      label: 'Аккаунт Telegram',
      admin: { position: 'sidebar' },
    },
    {
      name: 'orderId',
      type: 'text',
      label: 'Номер заказа',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
};
