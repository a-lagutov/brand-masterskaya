import type { GlobalConfig } from 'payload';

import { writeSiteSettings } from '../bot/siteSettings';

/** Switches for the public site that the owners flip without a deploy. */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Настройки сайта',
  admin: {
    description: 'Переключатели для сайта. Применяются сразу после сохранения.',
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
  ],
};
