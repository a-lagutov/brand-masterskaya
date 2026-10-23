import { rename, writeFile } from 'node:fs/promises';

import type { Payload } from 'payload';

import { settings } from './settings';

/** Contacts shown until the panel sets its own; src/api/lib.php has the same defaults. */
export const DEFAULT_CONTACTS = {
  phone: '+79150446975',
  telegram: 'brandmasterskaya',
  email: 'contact@brandmasterskaya.ru',
};
/** International phone as the site stores it: a plus and 8-15 digits. */
export const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
/** Telegram usernames: 5-32 Latin letters, digits and underscores. */
export const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{5,32}$/;

export interface Contacts {
  phone: string;
  telegram: string;
  email: string;
}

/**
 * The contacts set in the panel, or the defaults for a field that is empty.
 * @param payload
 */
export async function loadContacts(payload: Payload): Promise<Contacts> {
  const siteSettings = await payload.findGlobal({ slug: 'site-settings', depth: 0 });
  return {
    phone: siteSettings.contactPhone || DEFAULT_CONTACTS.phone,
    telegram: siteSettings.contactTelegram || DEFAULT_CONTACTS.telegram,
    email: siteSettings.contactEmail || DEFAULT_CONTACTS.email,
  };
}

/**
 * A phone for people to read: +79150446975 becomes +7 915 044-69-75; other countries stay as is.
 * @param phone Phone as +79150446975.
 */
export function formatPhoneForReading(phone: string): string {
  const russian = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return russian ? `+7 ${russian[1]} ${russian[2]}-${russian[3]}-${russian[4]}` : phone;
}

/**
 * Writes the settings for the site: {"hideDolyame": <bool>, "contactPhone": ..., "contactTelegram":
 * ..., "contactEmail": ...}. src/api/prices.php reads the switch to decide whether the page shows
 * the Dolyame button; src/api/contacts.php and the letter to the buyer read the contacts.
 * @param payload
 */
export async function writeSiteSettings(payload: Payload): Promise<void> {
  if (!settings.siteSettingsFile) {
    return;
  }
  const siteSettings = await payload.findGlobal({ slug: 'site-settings', depth: 0 });
  const contacts = await loadContacts(payload);
  const forSite = {
    hideDolyame: siteSettings.hideDolyame !== false,
    contactPhone: contacts.phone,
    contactTelegram: contacts.telegram,
    contactEmail: contacts.email,
  };
  // The site may read the file at any moment; a rename never leaves it half-written.
  const temporaryFile = `${settings.siteSettingsFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(forSite));
  await rename(temporaryFile, settings.siteSettingsFile);
  payload.logger.info(forSite, 'site settings written for the site');
}
