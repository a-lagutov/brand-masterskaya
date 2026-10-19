import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`promo_codes_discounts\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`product_id\` integer NOT NULL,
  	\`percent\` numeric NOT NULL,
  	FOREIGN KEY (\`product_id\`) REFERENCES \`products\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`promo_codes\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`promo_codes_discounts_order_idx\` ON \`promo_codes_discounts\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`promo_codes_discounts_parent_id_idx\` ON \`promo_codes_discounts\` (\`_parent_id\`);`)
  await db.run(sql`CREATE INDEX \`promo_codes_discounts_product_idx\` ON \`promo_codes_discounts\` (\`product_id\`);`)
  // Codes made before per-item percents: one row per chosen plan with the code's percent.
  await db.run(sql`INSERT INTO \`promo_codes_discounts\` (\`_order\`, \`_parent_id\`, \`id\`, \`product_id\`, \`percent\`)
    SELECT COALESCE(r.\`order\`, 1), r.\`parent_id\`, lower(hex(randomblob(12))), r.\`products_id\`, c.\`percent\`
    FROM \`promo_codes_rels\` r JOIN \`promo_codes\` c ON c.\`id\` = r.\`parent_id\`
    WHERE r.\`path\` = 'plans' AND r.\`products_id\` IS NOT NULL;`)
  await db.run(sql`DROP TABLE \`promo_codes_rels\`;`)
  await db.run(sql`ALTER TABLE \`promo_codes\` DROP COLUMN \`percent\`;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
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
  await db.run(sql`DROP TABLE \`promo_codes_discounts\`;`)
  await db.run(sql`ALTER TABLE \`promo_codes\` ADD \`percent\` numeric NOT NULL DEFAULT 10;`)
}
