import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload';

import { writePromoCodes } from '../bot/promoCodes';

/** What a buyer may type: Latin letters, digits, dash and underscore. */
const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
// 100% would make a zero price, which the bank does not accept.
const MAX_PERCENT = 99;

/**
 * Stores codes in upper case without spaces, so the site matches them however they are typed.
 */
const normalizeCode: CollectionBeforeValidateHook = ({ data }) => {
  if (typeof data?.code === 'string') {
    return { ...data, code: data.code.trim().toUpperCase() };
  }
  return data;
};

/**
 * Discount codes buyers enter in the site's form. A code lowers the price of the chosen plans
 * only; electives are always charged in full. The site sees changes right after saving
 * (~/private/<site>/promocodes.json).
 */
export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  labels: { singular: 'Промокод', plural: 'Промокоды' },
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'percent', 'plans', 'active', 'validUntil'],
    description:
      'Скидка в процентах на выбранные тарифы; факультативы всегда без скидки. ' +
      'Сайт принимает код сразу после сохранения. Регистр букв неважен.',
  },
  hooks: {
    beforeValidate: [normalizeCode],
    afterChange: [({ req }) => writePromoCodes(req.payload)],
    afterDelete: [({ req }) => writePromoCodes(req.payload)],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      label: 'Код',
      required: true,
      unique: true,
      validate: (value: string | null | undefined) =>
        CODE_PATTERN.test(value ?? '') || 'От 3 до 32 латинских букв, цифр, «-» или «_».',
      admin: { description: 'Например, FRIENDS10.' },
    },
    {
      name: 'percent',
      type: 'number',
      label: 'Скидка, %',
      required: true,
      min: 1,
      max: MAX_PERCENT,
      admin: { step: 1 },
    },
    {
      name: 'plans',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      required: true,
      label: 'Действует на тарифы',
      // Electives are never discounted, so only plans can be picked.
      filterOptions: { kind: { equals: 'plan' } },
    },
    {
      name: 'active',
      type: 'checkbox',
      label: 'Действует',
      defaultValue: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'validUntil',
      type: 'date',
      label: 'Действует до',
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Пусто — без срока.',
      },
    },
    {
      name: 'note',
      type: 'textarea',
      label: 'Заметка',
      admin: { description: 'Для кого код; покупатели её не видят.' },
    },
  ],
};
