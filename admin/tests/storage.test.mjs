import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const directory = await mkdtemp(path.join(os.tmpdir(), 'brand-messaging-test-'));
// Run the real production migrations against an isolated database; no credentials or live services.
process.env.DATABASE_URL = `file:${path.join(directory, 'test.db')}`;
process.env.PAYLOAD_SECRET = 'isolated-test-secret-with-at-least-32-characters';
process.env.NODE_ENV = 'production';
for (const key of [
  'RUN_BOT',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'PRICES_FILE',
  'ORDERS_DIR',
  'SITE_SETTINGS_FILE',
  'PRICE_OVERRIDES_FILE',
  'PROMO_CODES_FILE',
])
  process.env[key] = '';

test('production migrations support campaigns and session fields remain private through access checks', async () => {
  const { getPayload } = await import('payload');
  process.env.TELEGRAM_BOT_TOKEN = '123:local-test-token';
  const { telegramApi } = await import('../src/bot/telegram.ts');
  telegramApi().getMe = async () => ({ id: 123, username: 'my_storage_bot' });
  const { default: config } = await import('../src/payload.config.ts');
  const payload = await getPayload({ config });
  try {
    const admin = await payload.create({
      collection: 'users',
      data: { email: 'storage-test@example.com', password: 'test-only-password-12345' },
    });
    const user = { ...admin, collection: 'users' };
    const { bulkOrderEndpoints } = await import('../src/bot/bulkOrders.ts');
    const { recipientSelectionEndpoint } = await import('../src/bot/recipientSelection.ts');
    const { serializeMessageDocument, initialMessageEditorState } =
      await import('../src/editor/messageDocument.ts');
    const { fillText } = await import('../src/bot/texts.ts');
    const { Broadcasts } = await import('../src/collections/Broadcasts.ts');
    const { BotTexts } = await import('../src/globals/BotTexts.ts');
    for (const endpoint of [...bulkOrderEndpoints, recipientSelectionEndpoint])
      await assert.rejects(() => endpoint.handler({ user: null }), /Нужен вход/);
    const importProduct = await payload.create({
      collection: 'products',
      data: { key: 'bulk_plan', title: 'Импорт', kind: 'plan', price: 100 },
    });
    const importInput = {
      source:
        'Имя\tEmail\tТарифы\tСумма\tОплачен\nИмпорт Анна\tbulkanna@example.com\tbulk_plan\t10\t07.11.2026\nИмпорт Борис\tbulkboris@example.com\tbulk_plan\t20\t',
      products: [],
      batchId: '11111111-1111-4111-8111-111111111111',
    };
    const importRequest = { user, payload, json: async () => importInput };
    const importPreview = await (await bulkOrderEndpoints[0].handler(importRequest)).json();
    assert.equal(importPreview.errors.length, 0);
    importInput.hash = importPreview.hash;
    const imported = await (await bulkOrderEndpoints[1].handler(importRequest)).json();
    assert.equal(imported.created, 2);
    const repeated = await (await bulkOrderEndpoints[1].handler(importRequest)).json();
    assert.equal(repeated.created, 0);
    assert.equal(repeated.skipped, 2);
    const recipientInput = {
      collection: 'orders',
      payment: 'paid',
      products: [importProduct.id],
      search: 'импорт',
      page: 1,
    };
    const recipientResult = await (
      await recipientSelectionEndpoint.handler({ user, payload, json: async () => recipientInput })
    ).json();
    assert.equal(recipientResult.total, 1);
    assert.equal(recipientResult.rows[0].name, 'Импорт Анна');
    const allRecipientIds = await (
      await recipientSelectionEndpoint.handler({
        user,
        payload,
        json: async () => ({ ...recipientInput, allIds: true }),
      })
    ).json();
    assert.deepEqual(allRecipientIds.ids, [recipientResult.rows[0].id]);
    const orderCount = (await payload.count({ collection: 'orders' })).totalDocs;
    const failedInput = {
      source: 'Имя\tСумма\nИмпорт Новый\t10\nИмпорт Ошибка\t20',
      products: [],
      batchId: '22222222-2222-4222-8222-222222222222',
    };
    failedInput.hash = (
      await (
        await bulkOrderEndpoints[0].handler({ user, payload, json: async () => failedInput })
      ).json()
    ).hash;
    const originalCreate = payload.create.bind(payload);
    payload.create = async (options) => {
      if (options.collection === 'orders' && options.data.name === 'Импорт Ошибка')
        throw new Error('Simulated database failure');
      return originalCreate(options);
    };
    try {
      await assert.rejects(
        () => bulkOrderEndpoints[1].handler({ user, payload, json: async () => failedInput }),
        /Импорт отменён/,
      );
    } finally {
      payload.create = originalCreate;
    }
    assert.equal((await payload.count({ collection: 'orders' })).totalDocs, orderCount);
    const richBotState = initialMessageEditorState('Здравствуйте, {name}! {contact}');
    richBotState.root.children[0].children[0].format = 1;
    const richBotText = serializeMessageDocument(richBotState);
    const savedBotTexts = await payload.updateGlobal({
      slug: 'bot-texts',
      data: { help: richBotText },
    });
    assert.equal(savedBotTexts.help, richBotText);
    assert.match(
      fillText(savedBotTexts.help, { ...savedBotTexts, contact: 'Контакты' }, { name: '<Анна>' }),
      /<b>Здравствуйте, &lt;Анна&gt;! Контакты<\/b>/,
    );
    assert.ok(
      BotTexts.fields
        .filter((field) => field.type === 'textarea')
        .every((field) => field.admin.components.Field.endsWith('#BotTextEditor')),
    );
    const retryField = Broadcasts.fields.find((field) => field.name === 'retryAt');
    assert.equal(retryField.admin.condition({ status: 'draft' }), false);
    assert.equal(
      retryField.admin.condition({ status: 'sending', retryAt: '2026-11-07T12:00:00Z' }),
      true,
    );
    assert.equal(
      retryField.admin.condition({ status: 'completed', retryAt: '2026-11-07T12:00:00Z' }),
      false,
    );
    const member = await payload.create({
      collection: 'members',
      data: { displayName: 'Анна', telegramId: '100', botStarted: true },
    });
    assert.equal(member.botStarted, true);
    const order = await payload.create({
      collection: 'orders',
      data: { name: 'Анна', member: member.id, paidAt: '2026-11-01' },
    });
    assert.match(order.orderId, /^[a-f0-9]{32}$/);
    assert.equal(order.botLink, `https://t.me/my_storage_bot?start=${order.orderId}`);
    const profile = await payload.findByID({ collection: 'members', id: member.id, depth: 0 });
    assert.equal(profile.botLink, order.botLink);
    const updatedManualOrder = await payload.update({
      collection: 'orders',
      id: order.id,
      overrideAccess: false,
      user,
      data: {
        total: 1250,
        paidAt: '2026-11-06T12:00:00.000Z',
        items: [{ title: 'Оплата по счёту', price: 1250 }],
      },
    });
    assert.equal(updatedManualOrder.total, 1250);
    assert.equal(updatedManualOrder.paidAt, '2026-11-06T12:00:00.000Z');
    assert.equal(updatedManualOrder.items[0].price, 1250);
    const unpaidManualOrder = await payload.update({
      collection: 'orders',
      id: order.id,
      overrideAccess: false,
      user,
      data: { paidAt: null, total: 0 },
    });
    assert.equal(unpaidManualOrder.paidAt, null);
    assert.equal(unpaidManualOrder.total, 0);
    const siteOrder = await payload.create({
      collection: 'orders',
      data: {
        name: 'Заказ сайта',
        total: 500,
        paidAt: '2026-11-01T12:00:00.000Z',
        items: [{ title: 'Оплата на сайте', price: 500 }],
        siteCopy: { total: 500 },
      },
    });
    const protectedSiteOrder = await payload.update({
      collection: 'orders',
      id: siteOrder.id,
      overrideAccess: false,
      user,
      data: { total: 900, paidAt: null, siteCopy: null, items: [{ title: 'Подмена', price: 900 }] },
    });
    assert.equal(protectedSiteOrder.total, 500);
    assert.equal(protectedSiteOrder.paidAt, '2026-11-01T12:00:00.000Z');
    assert.equal(protectedSiteOrder.items[0].price, 500);
    assert.deepEqual(protectedSiteOrder.siteCopy, { total: 500 });
    const synchronizedOrder = await payload.update({
      collection: 'orders',
      id: siteOrder.id,
      data: { total: 700, paidAt: '2026-11-02T12:00:00.000Z' },
    });
    assert.equal(synchronizedOrder.total, 700);
    const campaign = await payload.create({
      collection: 'broadcasts',
      data: { title: 'Тест', message: 'Привет, {name}', members: [member.id], orders: [order.id] },
    });
    assert.equal(campaign.status, 'draft');
    const saved = await payload.update({
      collection: 'broadcasts',
      id: campaign.id,
      data: {
        status: 'queued',
        deliveries: [{ telegramId: '100', text: 'Текст', state: 'pending' }],
      },
      context: { broadcastInternal: true },
    });
    assert.equal(saved.status, 'queued');
    await assert.rejects(
      () =>
        payload.update({ collection: 'broadcasts', id: campaign.id, data: { title: 'Подмена' } }),
      /нельзя изменить/,
    );
    await payload.updateGlobal({
      slug: 'telegram-account',
      data: { encryptedSession: 'encrypted-test-value', connected: true },
    });
    const visible = await payload.findGlobal({
      slug: 'telegram-account',
      overrideAccess: false,
      user,
    });
    assert.equal(visible.encryptedSession, undefined);
    assert.equal(visible.connected, true);
    await assert.rejects(
      () => payload.findGlobal({ slug: 'telegram-account', overrideAccess: false }),
      /not allowed|Forbidden/i,
    );
    await payload.create({
      collection: 'payload-locked-documents',
      data: {
        document: { relationTo: 'broadcasts', value: campaign.id },
        user: { relationTo: 'users', value: admin.id },
      },
    });
    const migration = await import('../src/migrations/20261107_035633_telegram_broadcasts.ts');
    await migration.down({ db: payload.db.drizzle, payload, req: {} });
    await migration.up({ db: payload.db.drizzle, payload, req: {} });
    const preserved = await payload.findByID({ collection: 'orders', id: order.id, depth: 0 });
    assert.equal(preserved.name, 'Анна');
    const preservedMember = await payload.findByID({
      collection: 'members',
      id: member.id,
      depth: 0,
    });
    assert.equal(preservedMember.telegramId, '100');
  } finally {
    await payload.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
