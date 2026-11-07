import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

/** Adds campaign storage, account session storage and member delivery eligibility. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`broadcasts\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`title\` text NOT NULL,
    \`sender\` text DEFAULT 'bot' NOT NULL,
    \`audience\` text DEFAULT 'selected' NOT NULL,
    \`payment\` text DEFAULT 'all' NOT NULL,
    \`message\` text NOT NULL,
    \`status\` text DEFAULT 'draft' NOT NULL,
    \`retry_at\` text,
    \`deliveries\` text,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`broadcasts_updated_at_idx\` ON \`broadcasts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`broadcasts_created_at_idx\` ON \`broadcasts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`broadcasts_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`members_id\` integer,
    \`orders_id\` integer,
    \`products_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`broadcasts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`members_id\`) REFERENCES \`members\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`orders_id\`) REFERENCES \`orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`products_id\`) REFERENCES \`products\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`broadcasts_rels_order_idx\` ON \`broadcasts_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`broadcasts_rels_parent_idx\` ON \`broadcasts_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`broadcasts_rels_path_idx\` ON \`broadcasts_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`broadcasts_rels_members_id_idx\` ON \`broadcasts_rels\` (\`members_id\`);`)
  await db.run(sql`CREATE INDEX \`broadcasts_rels_orders_id_idx\` ON \`broadcasts_rels\` (\`orders_id\`);`)
  await db.run(sql`CREATE INDEX \`broadcasts_rels_products_id_idx\` ON \`broadcasts_rels\` (\`products_id\`);`)
  await db.run(sql`CREATE TABLE \`telegram_account\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`connected\` integer,
    \`username\` text,
    \`owner_id\` text,
    \`encrypted_session\` text,
    \`updated_at\` text,
    \`created_at\` text
  );
  `)
  await db.run(sql`ALTER TABLE \`members\` ADD \`bot_started\` integer DEFAULT false;`)
  // Existing members were imported from the previous bot or already contacted it.
  await db.run(sql`UPDATE \`members\` SET \`bot_started\` = 1;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`broadcasts_id\` integer REFERENCES broadcasts(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_broadcasts_id_idx\` ON \`payload_locked_documents_rels\` (\`broadcasts_id\`);`)
}

/** Removes campaign storage while preserving existing users, orders and document locks. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Remove only locks referencing campaigns before dropping their foreign-key target.
  await db.run(sql`DELETE FROM \`payload_locked_documents\` WHERE \`id\` IN (SELECT \`parent_id\` FROM \`payload_locked_documents_rels\` WHERE \`broadcasts_id\` IS NOT NULL);`)
  await db.run(sql`DROP TABLE \`broadcasts_rels\`;`)
  await db.run(sql`DROP TABLE \`broadcasts\`;`)
  await db.run(sql`DROP TABLE \`telegram_account\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`orders_id\` integer,
    \`members_id\` integer,
    \`chats_id\` integer,
    \`products_id\` integer,
    \`promo_codes_id\` integer,
    \`scenarios_id\` integer,
    \`users_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`orders_id\`) REFERENCES \`orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`members_id\`) REFERENCES \`members\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`chats_id\`) REFERENCES \`chats\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`products_id\`) REFERENCES \`products\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`promo_codes_id\`) REFERENCES \`promo_codes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`scenarios_id\`) REFERENCES \`scenarios\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "orders_id", "members_id", "chats_id", "products_id", "promo_codes_id", "scenarios_id", "users_id") SELECT "id", "order", "parent_id", "path", "orders_id", "members_id", "chats_id", "products_id", "promo_codes_id", "scenarios_id", "users_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_orders_id_idx\` ON \`payload_locked_documents_rels\` (\`orders_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_members_id_idx\` ON \`payload_locked_documents_rels\` (\`members_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_chats_id_idx\` ON \`payload_locked_documents_rels\` (\`chats_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_products_id_idx\` ON \`payload_locked_documents_rels\` (\`products_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_promo_codes_id_idx\` ON \`payload_locked_documents_rels\` (\`promo_codes_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_scenarios_id_idx\` ON \`payload_locked_documents_rels\` (\`scenarios_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`ALTER TABLE \`members\` DROP COLUMN \`bot_started\`;`)
}
