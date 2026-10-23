import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_owner_name\` text DEFAULT 'Аверьянова Ольга Владимировна' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_owner_name_genitive\` text DEFAULT 'Аверьяновой Ольги Владимировны' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_owner_name_dative\` text DEFAULT 'Аверьяновой Ольге Владимировне' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_owner_name_instrumental\` text DEFAULT 'Аверьяновой Ольгой Владимировной' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_inn\` text DEFAULT '420526003907' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_ogrnip\` text DEFAULT '326420500014874' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_bank_account\` text DEFAULT '40802810020000903497' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_bank_name\` text DEFAULT 'ООО «Банк Точка»' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_bik\` text DEFAULT '044525104' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`site_settings\` ADD \`legal_correspondent_account\` text DEFAULT '30101810745374525104' NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_owner_name\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_owner_name_genitive\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_owner_name_dative\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_owner_name_instrumental\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_inn\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_ogrnip\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_bank_account\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_bank_name\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_bik\`;`)
  await db.run(sql`ALTER TABLE \`site_settings\` DROP COLUMN \`legal_correspondent_account\`;`)
}
