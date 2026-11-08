import { type MigrateUpArgs, type MigrateDownArgs, sql } from '@payloadcms/db-sqlite';

/** Retires groups from the active schema; retain legacy tables and relations for a lossless rollback. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Runtime collection removal closes group APIs and access; deleting old rows is unnecessary.
  await db.run(sql`SELECT 1;`);
}

/** Existing group tables and relations remain intact, so restoring the old schema needs no data rewrite. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`SELECT 1;`);
}
