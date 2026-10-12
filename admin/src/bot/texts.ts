import type { Payload } from 'payload';

import type { BotText } from '../payload-types';
import { settings } from './settings';

/** Message options for texts from fillText: links are HTML. */
export const MESSAGE_FORMAT = { parse_mode: 'HTML' } as const;

/** A link in a text from the panel: [words](address), e.g. [на сайте]({site}). */
const LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/**
 * Escapes text for a Telegram message in HTML mode.
 * @param text
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Turns a text from the panel into a message: [words](address) becomes a link and
 * {placeholders} are filled; {site} and {contact} are always available. Send the result
 * with MESSAGE_FORMAT.
 * @param template Text with placeholders.
 * @param texts The bot texts, for the contact email.
 * @param values More placeholder values, e.g. name.
 */
export function fillText(
  template: string,
  texts: BotText,
  values: Record<string, string> = {},
): string {
  const allValues: Record<string, string> = {
    site: settings.siteUrl,
    contact: texts.contact,
    ...values,
  };
  // Links come before the values, so a name like "[x](y)" stays plain text.
  const withLinks = escapeHtml(template).replace(
    LINK_PATTERN,
    (link, words: string, address: string) => `<a href="${address}">${words}</a>`,
  );
  return withLinks.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in allValues ? escapeHtml(allValues[name]) : placeholder,
  );
}

/**
 * The bot texts as set in the panel.
 * @param payload
 */
export function loadTexts(payload: Payload): Promise<BotText> {
  return payload.findGlobal({ slug: 'bot-texts', depth: 0 });
}

/**
 * A price in rubles for messages, e.g. "219 900 ₽".
 * @param rubles
 */
export function formatPrice(rubles: number): string {
  return `${rubles.toLocaleString('ru-RU').replace(/ /g, ' ')} ₽`;
}
