import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

/** Adds scheduling metadata without changing existing campaign contents or delivery state. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`schedule_mode\` text DEFAULT 'now' NOT NULL;`)
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`scheduled_at\` text;`)
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`schedule_until\` text;`)
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`next_run_at\` text;`)
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`schedule_error\` text;`)
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`parent_broadcast_id\` integer REFERENCES broadcasts(id);`)
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`scheduled_for\` text;`)
  await db.run(sql`ALTER TABLE \`broadcasts\` ADD \`occurrence_key\` text;`)
  await db.run(sql`CREATE INDEX \`broadcasts_next_run_at_idx\` ON \`broadcasts\` (\`next_run_at\`);`)
  await db.run(sql`CREATE INDEX \`broadcasts_parent_broadcast_idx\` ON \`broadcasts\` (\`parent_broadcast_id\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`broadcasts_occurrence_key_idx\` ON \`broadcasts\` (\`occurrence_key\`);`)
}

/** Removes only scheduling columns, retaining campaign history and all existing relationships. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Older versions cannot dispatch schedule parents; finish them before removing their metadata.
  await db.run(sql`UPDATE broadcasts SET status = 'completed' WHERE status IN ('scheduled', 'cancelled');`)
  await db.run(sql`DROP INDEX broadcasts_next_run_at_idx;`)
  await db.run(sql`DROP INDEX broadcasts_parent_broadcast_idx;`)
  await db.run(sql`DROP INDEX broadcasts_occurrence_key_idx;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN schedule_mode;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN scheduled_at;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN schedule_until;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN next_run_at;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN schedule_error;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN parent_broadcast_id;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN scheduled_for;`)
  await db.run(sql`ALTER TABLE broadcasts DROP COLUMN occurrence_key;`)
}
