import { randomBytes } from 'node:crypto';

import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload';

import { relationIds } from '../bot/relations';

/** Fields set once, when the order appears; the site's sync still fills the payment in. */
const setOnCreateOnly = { update: () => false };

/**
 * Stamps the time the order was bound to a Telegram account, or cleared.
 */
const stampMemberChange: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const before = relationIds(originalDoc?.member)[0] ?? null;
  const after = relationIds(data.member)[0] ?? null;
  if (before !== after) {
    data.memberChangedAt = new Date().toISOString();
  }
  return data;
};

/**
 * Orders from the site, copied here by the bot every minute (src/bot/orders.ts), and orders
 * added by hand, e.g. paid by invoice. Edits made here stay: the sync overwrites only what
 * changes on the site afterwards, such as the payment.
 */
export const Orders: CollectionConfig = {
  slug: 'orders',
  labels: { singular: 'Заказ', plural: 'Заказы' },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'products', 'total', 'paidAt', 'member'],
    listSearchableFields: ['name', 'email', 'phone', 'telegram', 'orderId'],
    description:
      'Заказы с сайта обновляются раз в минуту; правки здесь сохраняются. Заказ можно добавить ' +
      'вручную — ссылку на бота с его номером отправьте человеку. Чтобы заказ можно было ' +
      'привязать к другому аккаунту Telegram, очистите поле «Аккаунт Telegram».',
  },
  defaultSort: '-createdOnSite',
  access: {
    // A deleted site order would come back with the next sync.
    delete: () => false,
  },
  hooks: {
    beforeChange: [stampMemberChange],
  },
  fields: [
    { name: 'name', type: 'text', label: 'Имя' },
    {
      type: 'row',
      fields: [
        { name: 'email', type: 'email', label: 'Email' },
        { name: 'phone', type: 'text', label: 'Телефон' },
        { name: 'telegram', type: 'text', label: 'Telegram из формы' },
      ],
    },
    {
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Тариф и факультативы',
      admin: { description: 'По ним бот решает, в какие чаты пустить.' },
    },
    {
      name: 'items',
      type: 'array',
      label: 'Позиции',
      admin: { initCollapsed: true },
      fields: [
        { name: 'title', type: 'text', label: 'Название' },
        { name: 'price', type: 'number', label: 'Цена, ₽' },
      ],
    },
    { name: 'total', type: 'number', label: 'Сумма, ₽' },
    {
      type: 'row',
      fields: [
        {
          name: 'createdOnSite',
          type: 'date',
          label: 'Создан',
          defaultValue: () => new Date().toISOString(),
          access: setOnCreateOnly,
          admin: { date: { pickerAppearance: 'dayAndTime' } },
        },
        {
          name: 'paidAt',
          type: 'date',
          label: 'Оплачен',
          access: setOnCreateOnly,
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description: 'Пусто — оплата не прошла. Задаётся только при создании.',
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
      name: 'memberChangedAt',
      type: 'date',
      label: 'Аккаунт изменён',
      admin: {
        readOnly: true,
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
      },
    },
    {
      name: 'orderId',
      type: 'text',
      label: 'Номер заказа',
      required: true,
      unique: true,
      index: true,
      // Same format as the site's ids, so /start <id> works for orders added by hand.
      defaultValue: () => randomBytes(16).toString('hex'),
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'siteCopy',
      type: 'json',
      label: 'Последняя копия с сайта',
      admin: { hidden: true },
    },
  ],
};
