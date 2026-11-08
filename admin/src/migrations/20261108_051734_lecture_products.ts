import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

/** Adds purchase-based lecture access without changing existing groups or orders. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`lectures_rels\` ADD \`products_id\` integer REFERENCES products(id);`)
  await db.run(sql`CREATE INDEX \`lectures_rels_products_id_idx\` ON \`lectures_rels\` (\`products_id\`);`)
}

/** Removes product access relations while retaining lecture and manual group data. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DELETE FROM \`lectures_rels\` WHERE \`path\` = 'products';`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_lectures_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`learning_groups_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`lectures\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`learning_groups_id\`) REFERENCES \`learning_groups\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_lectures_rels\`("id", "order", "parent_id", "path", "learning_groups_id") SELECT "id", "order", "parent_id", "path", "learning_groups_id" FROM \`lectures_rels\`;`)
  await db.run(sql`DROP TABLE \`lectures_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_lectures_rels\` RENAME TO \`lectures_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`lectures_rels_order_idx\` ON \`lectures_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`lectures_rels_parent_idx\` ON \`lectures_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`lectures_rels_path_idx\` ON \`lectures_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`lectures_rels_learning_groups_id_idx\` ON \`lectures_rels\` (\`learning_groups_id\`);`)
}
