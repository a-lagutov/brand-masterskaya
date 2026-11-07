import type { FieldHook, Payload } from 'payload';
import { botStartLink } from './messaging';
import { telegramApi } from './telegram';
import { settings } from './settings';

let usernamePromise: Promise<string> | undefined;

/** Uses an explicit link target or fetches the authenticated bot username once. */
export async function loadBotUsername(): Promise<string> {
  const configuredUsername = settings.botUsername.trim().replace(/^@/, '');
  if (configuredUsername) {
    // Validate the target with the same rules as the generated deep link.
    botStartLink(configuredUsername);
    return configuredUsername;
  }
  const api = telegramApi();
  if (!api) throw new Error('Задайте TELEGRAM_BOT_USERNAME или TELEGRAM_BOT_TOKEN.');
  usernamePromise ??= api
    .getMe()
    .then((bot) => bot.username)
    .catch((error) => {
      usernamePromise = undefined;
      throw error;
    });
  return usernamePromise;
}

/** Uses the latest paid order for an existing member, preserving purchase claim behavior. */
export async function memberBotLink(payload: Payload, memberId: number): Promise<string> {
  const result = await payload.find({
    collection: 'orders',
    where: { member: { equals: memberId }, paidAt: { exists: true } },
    sort: '-createdOnSite',
    limit: 1,
    depth: 0,
  });
  return botStartLink(await loadBotUsername(), result.docs[0]?.orderId);
}

/** Computes the profile link without persisting bot identity or changing order bindings. */
export const profileBotLink: FieldHook = async ({ siblingData, collection, req }) => {
  try {
    return collection?.slug === 'orders'
      ? botStartLink(await loadBotUsername(), siblingData.orderId)
      : await memberBotLink(req.payload, siblingData.id);
  } catch {
    return '';
  }
};
