import type { Payload } from 'payload';

import type { BotText } from '../payload-types';
import { settings } from './settings';

/**
 * Fills {placeholders} in a text; {site} and {contact} are always available.
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
  return template.replace(
    /\{(\w+)\}/g,
    (placeholder, name: string) => allValues[name] ?? placeholder,
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
