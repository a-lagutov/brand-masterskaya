import type { GlobalConfig } from 'payload';

import {
  DEFAULT_CONTACTS,
  PHONE_PATTERN,
  TELEGRAM_PATTERN,
  writeSiteSettings,
} from '../bot/siteSettings';

/** Switches and contacts for the public site that the owners change without a deploy. */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Настройки сайта',
  admin: {
    description: 'Переключатели и контакты для сайта. Применяются сразу после сохранения.',
  },
  hooks: {
    afterChange: [({ req }) => writeSiteSettings(req.payload)],
  },
  fields: [
    {
      name: 'hideDolyame',
      type: 'checkbox',
      label: 'Скрыть кнопку «Оплатить частями в Долями»',
      // Hidden until someone turns it on: a real-money button must not appear by accident.
      defaultValue: true,
      admin: {
        description:
          'Это вторая кнопка под основной «Перейти к оплате». Оплата картой и СБП не меняется.',
      },
    },
    {
      type: 'collapsible',
      label: 'Контакты',
      admin: {
        description:
          'Показываются на сайте (подвал, договор-оферта, политика, страница после оплаты), в письме покупателю и в сообщениях бота.',
      },
      fields: [
        {
          name: 'contactPhone',
          type: 'text',
          label: 'Телефон',
          required: true,
          defaultValue: DEFAULT_CONTACTS.phone,
          validate: (value: string | null | undefined) =>
            PHONE_PATTERN.test(value ?? '') || 'Телефон в формате +79001234567: плюс и 8–15 цифр',
        },
        {
          name: 'contactTelegram',
          type: 'text',
          label: 'Telegram',
          required: true,
          defaultValue: DEFAULT_CONTACTS.telegram,
          admin: { description: 'Ник без @, например brandmasterskaya.' },
          validate: (value: string | null | undefined) =>
            TELEGRAM_PATTERN.test(value ?? '') ||
            'Ник из 5–32 латинских букв, цифр и подчёркиваний, без @',
        },
        {
          name: 'contactEmail',
          type: 'email',
          label: 'Email',
          required: true,
          defaultValue: DEFAULT_CONTACTS.email,
        },
      ],
    },
  ],
};
