import type { GlobalConfig } from 'payload';

import {
  DEFAULT_CONTACTS,
  DEFAULT_LEGAL,
  LEGAL_DIGIT_PATTERNS,
  LEGAL_FIELD_NAMES,
  type LegalKey,
  PHONE_PATTERN,
  TELEGRAM_PATTERN,
  writeSiteSettings,
} from '../bot/siteSettings';

/** Where the details come from: what each legal field is called in the panel and what it needs. */
const LEGAL_FIELDS: { key: LegalKey; label: string; description?: string }[] = [
  {
    key: 'ownerName',
    label: 'ФИО предпринимателя',
    description:
      'Именительный падеж: Аверьянова Ольга Владимировна. Перед ним в текстах стоят слова «индивидуальный предприниматель» или «ИП».',
  },
  {
    key: 'ownerNameGenitive',
    label: 'ФИО — родительный падеж',
    description: 'Кого: Аверьяновой Ольги Владимировны.',
  },
  {
    key: 'ownerNameDative',
    label: 'ФИО — дательный падеж',
    description: 'Кому: Аверьяновой Ольге Владимировне.',
  },
  {
    key: 'ownerNameInstrumental',
    label: 'ФИО — творительный падеж',
    description: 'С кем: Аверьяновой Ольгой Владимировной.',
  },
  { key: 'inn', label: 'ИНН', description: '10 или 12 цифр.' },
  { key: 'ogrnip', label: 'ОГРНИП', description: '15 цифр.' },
  { key: 'bankAccount', label: 'Расчётный счёт', description: '20 цифр.' },
  { key: 'bankName', label: 'Банк' },
  { key: 'bik', label: 'БИК', description: '9 цифр.' },
  { key: 'correspondentAccount', label: 'Корреспондентский счёт', description: '20 цифр.' },
];

/**
 * A field for one legal detail; digit-only details are checked for their length.
 * @param detail What to ask for.
 */
function legalField(detail: (typeof LEGAL_FIELDS)[number]) {
  const digitPattern = LEGAL_DIGIT_PATTERNS[detail.key];
  return {
    name: LEGAL_FIELD_NAMES[detail.key],
    type: 'text' as const,
    label: detail.label,
    required: true,
    defaultValue: DEFAULT_LEGAL[detail.key],
    maxLength: 200,
    admin: detail.description ? { description: detail.description } : undefined,
    validate: (value: string | null | undefined) => {
      const text = (value ?? '').trim();
      if (!text) return 'Заполните поле';
      if (digitPattern && !digitPattern.test(text)) return detail.description ?? 'Неверный формат';
      return true;
    },
  };
}

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
    {
      type: 'collapsible',
      label: 'Юридическая информация',
      admin: {
        description:
          'Подставляется в договор-оферту, политику обработки персональных данных, подвал сайта и реквизиты. Тексты документов от этого не переписываются: меняются только эти значения.',
      },
      fields: LEGAL_FIELDS.map(legalField),
    },
  ],
};
