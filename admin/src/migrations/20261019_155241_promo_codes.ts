import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`promo_codes\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`code\` text NOT NULL,
  	\`percent\` numeric NOT NULL,
  	\`active\` integer DEFAULT true,
  	\`valid_until\` text,
  	\`note\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`promo_codes_code_idx\` ON \`promo_codes\` (\`code\`);`)
  await db.run(sql`CREATE INDEX \`promo_codes_updated_at_idx\` ON \`promo_codes\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`promo_codes_created_at_idx\` ON \`promo_codes\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`promo_codes_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`products_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`promo_codes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`products_id\`) REFERENCES \`products\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`promo_codes_rels_order_idx\` ON \`promo_codes_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`promo_codes_rels_parent_idx\` ON \`promo_codes_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`promo_codes_rels_path_idx\` ON \`promo_codes_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`promo_codes_rels_products_id_idx\` ON \`promo_codes_rels\` (\`products_id\`);`)
  await db.run(sql`ALTER TABLE \`orders\` ADD \`promo_code\` text;`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`promo_codes_id\` integer REFERENCES promo_codes(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_promo_codes_id_idx\` ON \`payload_locked_documents_rels\` (\`promo_codes_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`promo_codes\`;`)
  await db.run(sql`DROP TABLE \`promo_codes_rels\`;`)
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
  	\`scenarios_id\` integer,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`orders_id\`) REFERENCES \`orders\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`members_id\`) REFERENCES \`members\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`chats_id\`) REFERENCES \`chats\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`products_id\`) REFERENCES \`products\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`scenarios_id\`) REFERENCES \`scenarios\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "orders_id", "members_id", "chats_id", "products_id", "scenarios_id", "users_id") SELECT "id", "order", "parent_id", "path", "orders_id", "members_id", "chats_id", "products_id", "scenarios_id", "users_id" FROM \`payload_locked_documents_rels\`;`)
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
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_scenarios_id_idx\` ON \`payload_locked_documents_rels\` (\`scenarios_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`ALTER TABLE \`orders\` DROP COLUMN \`promo_code\`;`)
}
