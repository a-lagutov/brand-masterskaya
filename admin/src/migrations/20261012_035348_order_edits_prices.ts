import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite';

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`orders\` ADD \`member_changed_at\` text;`);
  await db.run(sql`ALTER TABLE \`orders\` ADD \`site_copy\` text;`);
  await db.run(sql`ALTER TABLE \`products\` ADD \`price\` numeric;`);
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`orders\` DROP COLUMN \`member_changed_at\`;`);
  await db.run(sql`ALTER TABLE \`orders\` DROP COLUMN \`site_copy\`;`);
  await db.run(sql`ALTER TABLE \`products\` DROP COLUMN \`price\`;`);
}
