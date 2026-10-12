import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`orders\` ADD \`deleted_at\` text;`)
  await db.run(sql`CREATE INDEX \`orders_deleted_at_idx\` ON \`orders\` (\`deleted_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`orders_deleted_at_idx\`;`)
  await db.run(sql`ALTER TABLE \`orders\` DROP COLUMN \`deleted_at\`;`)
}
