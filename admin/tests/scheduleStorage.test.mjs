import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Production migrations and delivery accounting run only in disposable storage with a stubbed API.
const directory = await mkdtemp(path.join(os.tmpdir(), 'brand-schedule-storage-'));
process.env.DATABASE_URL = `file:${path.join(directory, 'test.db')}`;
process.env.PAYLOAD_SECRET = 'isolated-schedule-secret-at-least-32-characters';
process.env.NODE_ENV = 'production';
for (const key of [
  'RUN_BOT',
  'TELEGRAM_BOT_TOKEN',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'PRICES_FILE',
  'ORDERS_DIR',
  'SITE_SETTINGS_FILE',
  'PRICE_OVERRIDES_FILE',
  'PROMO_CODES_FILE',
])
  process.env[key] = '';

// The test explicitly invokes the scheduler; background work remains disabled throughout.
test('real storage schedules, lists child history, delivers ready runs and preserves data through rollback', async () => {
  const { getPayload } = await import('payload');
  process.env.TELEGRAM_BOT_TOKEN = '123:schedule-storage-test';
  const { telegramApi } = await import('../src/bot/telegram.ts');
  const api = telegramApi();
  api.getMe = async () => ({ id: 123, username: 'schedule_storage_bot' });
  const sent = [];
  api.sendMessage = async (telegramId, text) => {
    sent.push({ telegramId, text });
  };
  const { default: config } = await import('../src/payload.config.ts');
  const { dispatchScheduledBroadcasts, dispatchBroadcasts } =
    await import('../src/bot/broadcasts.ts');
  const payload = await getPayload({ config });
  try {
    const member = await payload.create({
      collection: 'members',
      data: { telegramId: '100', displayName: 'Анна', botStarted: true },
    });
    const original = await payload.create({
      collection: 'broadcasts',
      data: { title: 'Старый черновик', message: 'Сохранить текст', members: [member.id] },
    });
    assert.equal(original.scheduleMode, 'now');
    const due = new Date(Date.now() - 1000).toISOString();
    const parent = await payload.create({
      collection: 'broadcasts',
      data: {
        title: 'Один раз',
        message: 'Привет, {name}',
        audience: 'all',
        scheduleMode: 'once',
        scheduledAt: due,
        status: 'scheduled',
        nextRunAt: due,
      },
      context: { broadcastInternal: true },
    });
    await dispatchScheduledBroadcasts(payload);
    await dispatchScheduledBroadcasts(payload);
    const children = await payload.find({
      collection: 'broadcasts',
      where: { parentBroadcast: { equals: parent.id } },
      depth: 0,
    });
    assert.equal(children.totalDocs, 1);
    const child = children.docs[0];
    assert.equal(child.status, 'queued');
    assert.equal(child.deliveries[0].text, 'Привет, Анна');
    const history = await payload.findByID({
      collection: 'broadcasts',
      id: parent.id,
      depth: 0,
      joins: { runs: { limit: 10 } },
    });
    assert.equal(history.runs.docs.length, 1);
    await assert.rejects(
      () =>
        payload.create({
          collection: 'broadcasts',
          data: {
            title: 'Дубликат',
            message: 'Не отправлять',
            occurrenceKey: child.occurrenceKey,
          },
          context: { broadcastInternal: true },
        }),
      /occurrenceKey/,
    );
    const cooling = await payload.create({
      collection: 'broadcasts',
      data: {
        title: 'Пауза',
        message: 'Ждать',
        status: 'sending',
        retryAt: new Date(Date.now() + 60_000).toISOString(),
        deliveries: [{ name: 'Анна', telegramId: '100', text: 'Ждать', state: 'pending' }],
      },
      context: { broadcastInternal: true },
    });
    // Force the older cooled-down campaign ahead of the child in the dispatcher's sort order.
    await payload.update({
      collection: 'broadcasts',
      id: cooling.id,
      data: { createdAt: '2000-01-01T00:00:00.000Z' },
      context: { broadcastInternal: true },
    });
    await dispatchBroadcasts(payload);
    assert.deepEqual(sent, [{ telegramId: '100', text: 'Привет, Анна' }]);
    await dispatchScheduledBroadcasts(payload);
    assert.equal(
      (await payload.findByID({ collection: 'broadcasts', id: parent.id })).status,
      'completed',
    );
    assert.equal(
      (await payload.findByID({ collection: 'broadcasts', id: cooling.id })).deliveries[0].state,
      'pending',
    );
    // A real approved schedule cannot be edited through ordinary Local API writes either.
    await assert.rejects(
      () =>
        payload.update({ collection: 'broadcasts', id: parent.id, data: { message: 'Подмена' } }),
      /нельзя изменить/,
    );
    const migration = await import('../src/migrations/20261107_063906_broadcast_schedules.ts');
    await migration.down({ db: payload.db.drizzle, payload, req: {} });
    await migration.up({ db: payload.db.drizzle, payload, req: {} });
    const restored = await payload.findByID({
      collection: 'broadcasts',
      id: original.id,
      depth: 0,
    });
    assert.equal(restored.message, 'Сохранить текст');
    assert.equal(restored.status, 'draft');
    assert.deepEqual(restored.members, [member.id]);
    assert.equal(restored.scheduleMode, 'now');
    const preservedChild = await payload.findByID({
      collection: 'broadcasts',
      id: child.id,
      depth: 0,
    });
    assert.equal(preservedChild.deliveries[0].state, 'sent');
    assert.equal(
      (await payload.findByID({ collection: 'members', id: member.id })).telegramId,
      '100',
    );
  } finally {
    await payload.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
