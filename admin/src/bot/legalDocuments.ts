import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Payload } from 'payload';

import { renderLegalMarkdown } from './legalMarkdown';
import { settings } from './settings';

/** The documents whose text the panel edits, with the name of their field and file. */
export const LEGAL_DOCUMENTS = [
  { name: 'oferta', title: 'Договор-оферта' },
  { name: 'privacy', title: 'Политика обработки персональных данных' },
] as const;
export type LegalDocumentName = (typeof LEGAL_DOCUMENTS)[number]['name'];

/** What a {{variable}} in the text stands for; the site fills them in (src/api/legal.php). */
export const LEGAL_VARIABLES: Record<string, string> = {
  ownerName: 'ФИО предпринимателя, именительный падеж',
  ownerNameGenitive: 'ФИО, родительный падеж',
  ownerNameDative: 'ФИО, дательный падеж',
  ownerNameInstrumental: 'ФИО, творительный падеж',
  inn: 'ИНН',
  ogrnip: 'ОГРНИП',
  bankAccount: 'расчётный счёт',
  bankName: 'банк',
  bik: 'БИК',
  correspondentAccount: 'корсчёт',
  phone: 'телефон для ссылки, +79150446975',
  phoneText: 'телефон для чтения, +7 915 044-69-75',
  telegram: 'ник в Telegram без @',
  email: 'email',
  site: 'адрес сайта, https://…',
  domain: 'домен сайта',
};

/** Tags and attributes that would run code on the site; the site ignores such a text.
 * Checked on the Markdown, where raw HTML is allowed. */
const UNSAFE_MARKUP = /<\s*(script|iframe|object|embed)\b|\son\w+\s*=|javascript:/i;

/**
 * Checks a text from the panel: no code, only known {{variables}}.
 * @param text The document's HTML.
 * @returns True, or the message for the editor.
 */
export function validateLegalText(text: string | null | undefined): true | string {
  if (!text) {
    return true;
  }
  if (UNSAFE_MARKUP.test(text)) {
    return 'В тексте не должно быть script, iframe, object, embed, onclick= и javascript:';
  }
  const unknown = [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .map((match) => match[1])
    .filter((variable) => !(variable in LEGAL_VARIABLES));
  if (unknown.length > 0) {
    return `Неизвестные переменные: ${[...new Set(unknown)].map((name) => `{{${name}}}`).join(', ')}`;
  }
  return true;
}

/** Folder of the shipped texts (Markdown), dist/api/legal next to the site's prices.json. */
function templatesDir(): string {
  return settings.pricesFile ? path.join(path.dirname(settings.pricesFile), 'legal') : '';
}

/** Where the site reads the saved texts: next to site-settings.json. */
function documentsDir(): string {
  return settings.siteSettingsFile ? path.dirname(settings.siteSettingsFile) : '';
}

/**
 * Writes the texts for the site as HTML, legal-<name>.html, rendered from the Markdown in the
 * panel; an empty text removes the file, so the site shows the shipped one. src/api/legal.php
 * reads them.
 * @param payload
 */
export async function writeLegalDocuments(payload: Payload): Promise<void> {
  const directory = documentsDir();
  if (!directory) {
    return;
  }
  const documents = await payload.findGlobal({ slug: 'legal-documents', depth: 0 });
  await mkdir(directory, { recursive: true });
  for (const { name } of LEGAL_DOCUMENTS) {
    const file = path.join(directory, `legal-${name}.html`);
    const text = (documents[name] ?? '').trim();
    if (!text) {
      await rm(file, { force: true });
      continue;
    }
    // The site may read the file at any moment; a rename never leaves it half-written.
    await writeFile(`${file}.tmp`, renderLegalMarkdown(text));
    await rename(`${file}.tmp`, file);
  }
  payload.logger.info('legal documents written for the site');
}

/**
 * Fills an empty document with the text shipped with the site, so the panel opens with the
 * current text to edit. A text already in the panel is never touched.
 * @param payload
 */
export async function seedLegalDocuments(payload: Payload): Promise<void> {
  const directory = templatesDir();
  if (!directory) {
    return;
  }
  try {
    await fillEmptyDocuments(payload, directory);
  } catch (error) {
    // The panel must start even if the texts cannot be filled in.
    payload.logger.error({ err: error }, 'could not fill the legal documents');
  }
}

/**
 * Reads the shipped texts for the documents that are empty and saves them.
 * @param payload
 * @param directory Folder with oferta.md and privacy.md.
 */
async function fillEmptyDocuments(payload: Payload, directory: string): Promise<void> {
  const documents = await payload.findGlobal({ slug: 'legal-documents', depth: 0 });
  const seeded: Partial<Record<LegalDocumentName, string>> = {};
  for (const { name } of LEGAL_DOCUMENTS) {
    if (documents[name]?.trim()) {
      continue;
    }
    try {
      seeded[name] = await readFile(path.join(directory, `${name}.md`), 'utf8');
    } catch {
      payload.logger.warn(`no shipped text for ${name} in ${directory}`);
    }
  }
  if (Object.keys(seeded).length > 0) {
    await payload.updateGlobal({ slug: 'legal-documents', data: seeded });
    payload.logger.info(`legal documents filled from ${directory}`);
  }
}
