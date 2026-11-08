import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

/** Adds private lecture metadata and group membership without changing existing orders. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`learning_groups\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`learning_groups_updated_at_idx\` ON \`learning_groups\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`learning_groups_created_at_idx\` ON \`learning_groups\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`learning_groups_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`members_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`learning_groups\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`members_id\`) REFERENCES \`members\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`learning_groups_rels_order_idx\` ON \`learning_groups_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`learning_groups_rels_parent_idx\` ON \`learning_groups_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`learning_groups_rels_path_idx\` ON \`learning_groups_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`learning_groups_rels_members_id_idx\` ON \`learning_groups_rels\` (\`members_id\`);`)
  await db.run(sql`CREATE TABLE \`lectures\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`speaker\` text,
    \`description\` text,
    \`sort_order\` numeric DEFAULT 0,
    \`published\` integer DEFAULT false,
    \`processing_status\` text DEFAULT 'pending' NOT NULL,
    \`processing_error\` text,
    \`revision\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`url\` text,
    \`thumbnail_u_r_l\` text,
    \`filename\` text,
    \`mime_type\` text,
    \`filesize\` numeric,
    \`width\` numeric,
    \`height\` numeric,
    \`focal_x\` numeric,
    \`focal_y\` numeric
  );
  `)
  await db.run(sql`CREATE INDEX \`lectures_updated_at_idx\` ON \`lectures\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`lectures_created_at_idx\` ON \`lectures\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`lectures_filename_idx\` ON \`lectures\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`lectures_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`learning_groups_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`lectures\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`learning_groups_id\`) REFERENCES \`learning_groups\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`lectures_rels_order_idx\` ON \`lectures_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`lectures_rels_parent_idx\` ON \`lectures_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`lectures_rels_path_idx\` ON \`lectures_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`lectures_rels_learning_groups_id_idx\` ON \`lectures_rels\` (\`learning_groups_id\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`learning_groups_id\` integer REFERENCES learning_groups(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`lectures_id\` integer REFERENCES lectures(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_learning_groups_id_idx\` ON \`payload_locked_documents_rels\` (\`learning_groups_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_lectures_id_idx\` ON \`payload_locked_documents_rels\` (\`lectures_id\`);`)
}

/** Removes only the cabinet schema; restore its database backup to recover lecture assignments. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DELETE FROM payload_locked_documents_rels WHERE lectures_id IS NOT NULL OR learning_groups_id IS NOT NULL;`)
  await db.run(sql`DROP INDEX payload_locked_documents_rels_lectures_id_idx;`)
  await db.run(sql`DROP INDEX payload_locked_documents_rels_learning_groups_id_idx;`)
  await db.run(sql`ALTER TABLE payload_locked_documents_rels DROP COLUMN lectures_id;`)
  await db.run(sql`ALTER TABLE payload_locked_documents_rels DROP COLUMN learning_groups_id;`)
  await db.run(sql`DROP TABLE lectures_rels;`)
  await db.run(sql`DROP TABLE lectures;`)
  await db.run(sql`DROP TABLE learning_groups_rels;`)
  await db.run(sql`DROP TABLE learning_groups;`)
}
