import { Api } from 'grammy';

import { settings } from './settings';

let api: Api | null = null;

/**
 * The Bot API client, shared by the bot and the admin hooks; null without a token.
 * @returns The client or null.
 */
export function telegramApi(): Api | null {
  if (!settings.botToken) {
    return null;
  }
  api ??= new Api(settings.botToken, { apiRoot: settings.telegramApiUrl });
  return api;
}

/**
 * The bot's own Telegram id, the part of the token before the colon.
 * @returns The id, or 0 without a token.
 */
export function botUserId(): number {
  return Number(settings.botToken.split(':')[0]) || 0;
}
