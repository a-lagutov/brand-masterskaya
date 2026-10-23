import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`contact_phone\` text DEFAULT '+79150446975' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`contact_telegram\` text DEFAULT 'brandmasterskaya' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`contact_email\` text DEFAULT 'contact@brandmasterskaya.ru' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`bot_texts\` DROP COLUMN \`contact\`;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`bot_texts\` ADD \`contact\` text DEFAULT 'contact@brandmasterskaya.ru' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`contact_phone\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`contact_telegram\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`contact_email\`;`)
}
