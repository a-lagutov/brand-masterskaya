import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

/** Adds progress and a private lease token without changing existing lecture access. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`lectures\` ADD \`processing_job\` text;`)
  await db.run(sql`ALTER TABLE \`lectures\` ADD \`processing_progress\` numeric DEFAULT 0;`)
}

/** Removes worker bookkeeping while retaining lectures and access assignments. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`lectures\` DROP COLUMN \`processing_job\`;`)
  await db.run(sql`ALTER TABLE \`lectures\` DROP COLUMN \`processing_progress\`;`)
}
