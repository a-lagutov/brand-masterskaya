import type { ArrayFieldValidation, CollectionBeforeValidateHook, CollectionConfig } from 'payload';

import { writePromoCodes } from '../bot/promoCodes';
import { relationIds } from '../bot/relations';

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
 * Refuses a code that names the same plan or elective twice: the site would not know which
 * percent to take.
 * @param rows The discount rows.
 */
const validateDiscounts: ArrayFieldValidation = (rows) => {
  const productIds = (Array.isArray(rows) ? rows : []).flatMap((row) =>
    relationIds((row as { product?: Parameters<typeof relationIds>[0] }).product),
  );
  if (!productIds.length) {
    return 'Добавьте хотя бы один тариф или факультатив.';
  }
  return new Set(productIds).size === productIds.length || 'Каждая позиция — только один раз.';
};

/**
 * Discount codes buyers enter in the site's form. Each code lists plans and electives with
 * their own percent; positions not listed are charged in full. The site sees changes right
 * after saving (~/private/<site>/promocodes.json).
 */
export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  labels: { singular: 'Промокод', plural: 'Промокоды' },
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'discounts', 'active', 'validUntil'],
    description:
      'Скидка в процентах на выбранные тарифы и факультативы, у каждого свой процент; ' +
      'остальное — по полной цене. Сайт принимает код сразу после сохранения. Регистр букв неважен.',
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
      name: 'discounts',
      type: 'array',
      label: 'Скидки',
      labels: { singular: 'Скидка', plural: 'Скидки' },
      required: true,
      minRows: 1,
      validate: validateDiscounts,
      admin: {
        description: 'Тарифы и факультативы, на которые действует код, и процент для каждого.',
      },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'product',
              type: 'relationship',
              relationTo: 'products',
              required: true,
              label: 'Тариф или факультатив',
              admin: { width: '70%' },
            },
            {
              name: 'percent',
              type: 'number',
              label: 'Скидка, %',
              required: true,
              min: 1,
              max: MAX_PERCENT,
              admin: { step: 1, width: '30%' },
            },
          ],
        },
      ],
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
