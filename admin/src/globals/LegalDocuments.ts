import type { GlobalConfig } from 'payload';

import {
  LEGAL_DOCUMENTS,
  LEGAL_VARIABLES,
  validateLegalText,
  writeLegalDocuments,
} from '../bot/legalDocuments';

const VARIABLES_HINT = Object.entries(LEGAL_VARIABLES)
  .map(([name, meaning]) => `{{${name}}} — ${meaning}`)
  .join('; ');

/** Full texts of the offer and the privacy policy, with {{variables}} the site fills in. */
export const LegalDocuments: GlobalConfig = {
  slug: 'legal-documents',
  label: 'Юридические документы',
  admin: {
    description:
      'Полный текст договора-оферты и политики на сайте (HTML). Значения подставляются из «Настроек сайта» → ' +
      '«Контакты» и «Юридическая информация». Применяется сразу после сохранения. ' +
      'Если очистить поле и сохранить, сайт покажет текст, поставляемый с сайтом. Переменные: ' +
      VARIABLES_HINT,
  },
  hooks: {
    afterChange: [({ req }) => writeLegalDocuments(req.payload)],
  },
  fields: LEGAL_DOCUMENTS.map(({ name, title }) => ({
    name,
    type: 'code' as const,
    label: title,
    admin: { language: 'html' },
    validate: (value: string | null | undefined) => validateLegalText(value),
  })),
};
