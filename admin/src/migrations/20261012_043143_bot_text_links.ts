import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_bot_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`contact\` text DEFAULT 'contact@brandmasterskaya.ru' NOT NULL,
  	\`start\` text DEFAULT 'Здравствуйте! Это бот программы «Мастерская бренд-стратегии».
  
  Оплатить участие можно [на сайте]({site}).
  После оплаты откройте бота по кнопке на странице подтверждения заказа или по ссылке из письма.' NOT NULL,
  	\`paid\` text DEFAULT 'Здравствуйте, {name}! Оплата участия в программе «Мастерская бренд-стратегии» подтверждена ✅
  
  В заказе:
  {items}
  Итого: {total}' NOT NULL,
  	\`chats\` text DEFAULT 'Вступите в чаты программы по кнопкам ниже — бот сразу одобрит заявку.' NOT NULL,
  	\`chats_later\` text DEFAULT 'Ссылки на чаты программы появятся здесь ближе к старту: просто отправьте боту /start.' NOT NULL,
  	\`not_found\` text DEFAULT 'Не нашли заказ по этой ссылке. Если вы оплатили участие, напишите нам: {contact}' NOT NULL,
  	\`not_paid\` text DEFAULT 'Банк ещё не подтвердил оплату этого заказа. Попробуйте открыть ссылку через пару минут. Если деньги списались, а оплата не подтверждается, напишите нам: {contact}' NOT NULL,
  	\`other_account\` text DEFAULT 'Этот заказ уже привязан к другому аккаунту Telegram. Если это ошибка, напишите нам: {contact}' NOT NULL,
  	\`not_allowed\` text DEFAULT 'Эта команда доступна только участникам программы.' NOT NULL,
  	\`help\` text DEFAULT 'Если остались вопросы, напишите нам: {contact}' NOT NULL,
  	\`updated_at\` text,
  	\`created_at\` text
  );
  `)
  await db.run(sql`INSERT INTO \`__new_bot_texts\`("id", "contact", "start", "paid", "chats", "chats_later", "not_found", "not_paid", "other_account", "not_allowed", "help", "updated_at", "created_at") SELECT "id", "contact", "start", "paid", "chats", "chats_later", "not_found", "not_paid", "other_account", "not_allowed", "help", "updated_at", "created_at" FROM \`bot_texts\`;`)
  await db.run(sql`DROP TABLE \`bot_texts\`;`)
  await db.run(sql`ALTER TABLE \`__new_bot_texts\` RENAME TO \`bot_texts\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_bot_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`contact\` text DEFAULT 'contact@brandmasterskaya.ru' NOT NULL,
  	\`start\` text DEFAULT 'Здравствуйте! Это бот программы «Мастерская бренд-стратегии».
  
  Оплатить участие можно на сайте {site}. После оплаты откройте бота по кнопке на странице подтверждения заказа или по ссылке из письма.' NOT NULL,
  	\`paid\` text DEFAULT 'Здравствуйте, {name}! Оплата участия в программе «Мастерская бренд-стратегии» подтверждена ✅
  
  В заказе:
  {items}
  Итого: {total}' NOT NULL,
  	\`chats\` text DEFAULT 'Вступите в чаты программы по кнопкам ниже — бот сразу одобрит заявку.' NOT NULL,
  	\`chats_later\` text DEFAULT 'Ссылки на чаты программы появятся здесь ближе к старту: просто отправьте боту /start.' NOT NULL,
  	\`not_found\` text DEFAULT 'Не нашли заказ по этой ссылке. Если вы оплатили участие, напишите нам: {contact}' NOT NULL,
  	\`not_paid\` text DEFAULT 'Банк ещё не подтвердил оплату этого заказа. Попробуйте открыть ссылку через пару минут. Если деньги списались, а оплата не подтверждается, напишите нам: {contact}' NOT NULL,
  	\`other_account\` text DEFAULT 'Этот заказ уже привязан к другому аккаунту Telegram. Если это ошибка, напишите нам: {contact}' NOT NULL,
  	\`not_allowed\` text DEFAULT 'Эта команда доступна только участникам программы.' NOT NULL,
  	\`help\` text DEFAULT 'Если остались вопросы, напишите нам: {contact}' NOT NULL,
  	\`updated_at\` text,
  	\`created_at\` text
  );
  `)
  await db.run(sql`INSERT INTO \`__new_bot_texts\`("id", "contact", "start", "paid", "chats", "chats_later", "not_found", "not_paid", "other_account", "not_allowed", "help", "updated_at", "created_at") SELECT "id", "contact", "start", "paid", "chats", "chats_later", "not_found", "not_paid", "other_account", "not_allowed", "help", "updated_at", "created_at" FROM \`bot_texts\`;`)
  await db.run(sql`DROP TABLE \`bot_texts\`;`)
  await db.run(sql`ALTER TABLE \`__new_bot_texts\` RENAME TO \`bot_texts\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
}
