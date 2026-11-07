import type { GlobalConfig } from 'payload';
import { accountEndpoints } from '../bot/personalTelegram';

/** Personal account session is encrypted and never returned through public APIs. */
export const TelegramAccount: GlobalConfig = {
  slug: 'telegram-account',
  label: 'Telegram @brandmasterskaya',
  admin: {
    group: 'Настройки',
    description:
      'Подключение личного аккаунта через Telegram API. Получите api_id и api_hash на my.telegram.org. Сессия хранится зашифрованной. Рассылки подчиняются ограничениям Telegram, включая FLOOD_WAIT.',
  },
  access: { read: ({ req }) => Boolean(req.user), update: () => false },
  endpoints: accountEndpoints,
  fields: [
    { name: 'connected', type: 'checkbox', label: 'Подключён', admin: { readOnly: true } },
    { name: 'username', type: 'text', label: 'Аккаунт', admin: { readOnly: true } },
    { name: 'ownerId', type: 'text', label: 'Telegram ID', admin: { readOnly: true } },
    {
      name: 'connection',
      type: 'ui',
      admin: { components: { Field: '/components/TelegramAccountConnect#TelegramAccountConnect' } },
    },
    {
      name: 'encryptedSession',
      type: 'textarea',
      access: { read: () => false },
      admin: { hidden: true },
    },
  ],
};
