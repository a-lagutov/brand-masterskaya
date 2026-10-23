import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sqliteAdapter } from '@payloadcms/db-sqlite';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { ru } from '@payloadcms/translations/languages/ru';
import { buildConfig } from 'payload';
import sharp from 'sharp';

import { startBackgroundWork } from './bot';
import { Chats } from './collections/Chats';
import { Members } from './collections/Members';
import { Orders } from './collections/Orders';
import { Products } from './collections/Products';
import { PromoCodes } from './collections/PromoCodes';
import { Scenarios } from './collections/Scenarios';
import { Users } from './collections/Users';
import { seedLegalDocuments } from './bot/legalDocuments';
import { BotTexts } from './globals/BotTexts';
import { LegalDocuments } from './globals/LegalDocuments';
import { SiteSettings } from './globals/SiteSettings';
import { migrations } from './migrations';
import { ensureFirstAdmin } from './seed';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    components: { providers: ['/components/JsonRequests#JsonRequests'] },
    meta: { titleSuffix: ' — Мастерская бренд-стратегии' },
  },
  i18n: {
    supportedLanguages: { ru },
    fallbackLanguage: 'ru',
  },
  collections: [Orders, Members, Chats, Products, PromoCodes, Scenarios, Users],
  globals: [BotTexts, SiteSettings, LegalDocuments],
  editor: lexicalEditor(),
  graphQL: { disable: true },
  secret: process.env.PAYLOAD_SECRET ?? '',
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: sqliteAdapter({
    client: { url: process.env.DATABASE_URL ?? '' },
    // The hosting gets the schema from migrations (src/migrations), applied on start.
    prodMigrations: migrations,
  }),
  sharp,
  onInit: async (payload) => {
    await ensureFirstAdmin(payload);
    await seedLegalDocuments(payload);
    startBackgroundWork(payload);
  },
});
