import { rename, writeFile } from 'node:fs/promises';

import type { Payload } from 'payload';

import { settings } from './settings';

/** Contacts shown until the panel sets its own; src/api/lib.php has the same defaults. */
export const DEFAULT_CONTACTS = {
  phone: '+79150446975',
  telegram: 'brandmasterskaya',
  email: 'contact@brandmasterskaya.ru',
};
/** Legal details shown until the panel sets its own; src/api/lib.php and the pages have the same. */
export const DEFAULT_LEGAL = {
  ownerName: 'Аверьянова Ольга Владимировна',
  ownerNameGenitive: 'Аверьяновой Ольги Владимировны',
  ownerNameDative: 'Аверьяновой Ольге Владимировне',
  ownerNameInstrumental: 'Аверьяновой Ольгой Владимировной',
  inn: '420526003907',
  ogrnip: '326420500014874',
  bankAccount: '40802810020000903497',
  bankName: 'ООО «Банк Точка»',
  bik: '044525104',
  correspondentAccount: '30101810745374525104',
};
export type LegalKey = keyof typeof DEFAULT_LEGAL;
/** Digits only, exact lengths: INN of a person (12) or a company (10), OGRNIP, account, BIK. */
export const LEGAL_DIGIT_PATTERNS: Partial<Record<LegalKey, RegExp>> = {
  inn: /^(\d{10}|\d{12})$/,
  ogrnip: /^\d{15}$/,
  bankAccount: /^\d{20}$/,
  bik: /^\d{9}$/,
  correspondentAccount: /^\d{20}$/,
};
/** International phone as the site stores it: a plus and 8-15 digits. */
export const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
/** Telegram usernames: 5-32 Latin letters, digits and underscores. */
export const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{5,32}$/;

/** Name of the site-settings field for each legal detail. */
export const LEGAL_FIELD_NAMES = {
  ownerName: 'legalOwnerName',
  ownerNameGenitive: 'legalOwnerNameGenitive',
  ownerNameDative: 'legalOwnerNameDative',
  ownerNameInstrumental: 'legalOwnerNameInstrumental',
  inn: 'legalInn',
  ogrnip: 'legalOgrnip',
  bankAccount: 'legalBankAccount',
  bankName: 'legalBankName',
  bik: 'legalBik',
  correspondentAccount: 'legalCorrespondentAccount',
} as const satisfies Record<LegalKey, string>;

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
 * The legal details set in the panel, or the defaults for a field that is empty.
 * @param payload
 */
export async function loadLegal(payload: Payload): Promise<Record<LegalKey, string>> {
  const siteSettings = await payload.findGlobal({ slug: 'site-settings', depth: 0 });
  const legal = { ...DEFAULT_LEGAL };
  for (const key of Object.keys(DEFAULT_LEGAL) as LegalKey[]) {
    legal[key] = siteSettings[LEGAL_FIELD_NAMES[key]] || DEFAULT_LEGAL[key];
  }
  return legal;
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
 * ..., "contactEmail": ..., "legal": {"inn": ..., ...}}. src/api/prices.php reads the switch to
 * decide whether the page shows the Dolyame button; src/api/contacts.php reads the contacts and
 * the legal details, the letter to the buyer reads the contacts.
 * @param payload
 */
export async function writeSiteSettings(payload: Payload): Promise<void> {
  if (!settings.siteSettingsFile) {
    return;
  }
  const siteSettings = await payload.findGlobal({ slug: 'site-settings', depth: 0 });
  const contacts = await loadContacts(payload);
  const forSite = {
    legal: await loadLegal(payload),
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
