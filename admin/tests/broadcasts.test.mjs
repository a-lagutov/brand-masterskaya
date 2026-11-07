import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

// Telegram transport is stubbed before importing the dispatcher; tests never contact Telegram.
process.env.TELEGRAM_BOT_TOKEN = '123:local-test-token';
process.env.TELEGRAM_BOT_USERNAME = '';
process.env.RUN_BOT = '1';
const { telegramApi } = await import('../src/bot/telegram.ts');
const api = telegramApi();
api.getMe = async () => ({ id: 123, username: 'my_test_bot' });
const { prepareBroadcast, broadcastEndpoints, dispatchBroadcasts } =
  await import('../src/bot/broadcasts.ts');
const { Broadcasts } = await import('../src/collections/Broadcasts.ts');
const { accountEndpoints, resolvePersonalPeer } = await import('../src/bot/personalTelegram.ts');
const { Api, TelegramClient } = await import('teleproto');
const { encryptSession } = await import('../src/bot/sessionEncryption.ts');
const { default: bigInteger } = await import('big-integer');

/** Creates a minimal in-memory Payload boundary for deterministic campaign integration tests. */
function createPayload(changes = {}) {
  const campaign = {
    id: 1,
    title: 'Тест',
    sender: 'bot',
    audience: 'all',
    payment: 'paid',
    message: 'Привет, {name}! {bot_link}',
    status: 'draft',
    updatedAt: '2026-11-07T12:00:00Z',
    ...changes,
  };
  const members = [
    { id: 1, displayName: 'Анна', telegramId: '100', botStarted: true },
    { id: 2, displayName: 'Иван', telegramId: '200', botStarted: false },
  ];
  const orders = [
    {
      id: 1,
      member: 1,
      orderId: 'a'.repeat(32),
      name: 'Анна Петрова',
      paidAt: '2026-11-01',
      products: [],
    },
    { id: 2, member: 2, orderId: 'b'.repeat(32), name: 'Иван', paidAt: '2026-11-01', products: [] },
    { id: 3, orderId: 'c'.repeat(32), name: 'Ещё не в боте', paidAt: '2026-11-01', products: [] },
  ];
  return {
    campaign,
    members,
    orders,
    logger: { error() {} },
    async find({ collection }) {
      return {
        docs:
          collection === 'members'
            ? members
            : collection === 'orders'
              ? orders
              : ['queued', 'sending'].includes(campaign.status)
                ? [structuredClone(campaign)]
                : [],
      };
    },
    async findByID() {
      return structuredClone(campaign);
    },
    async update({ data }) {
      Object.assign(campaign, structuredClone(data));
      return structuredClone(campaign);
    },
  };
}

/** Builds an authenticated endpoint request without a network server. */
function createRequest(payload, body = {}) {
  return {
    user: { id: 1, collection: 'users' },
    payload,
    routeParams: { id: '1' },
    json: async () => body,
  };
}

test('preview substitutes purchase link, skips unreachable users and never sends', async () => {
  const payload = createPayload();
  const preview = await prepareBroadcast(payload, payload.campaign);
  assert.equal(preview.deliveries.length, 1);
  assert.equal(preview.skipped.length, 2);
  assert.match(preview.deliveries[0].text, new RegExp(`start=${'a'.repeat(32)}`));
  assert.equal(payload.campaign.status, 'draft');
});

test('endpoints reject anonymous preview, send and account-login operations', async () => {
  for (const endpoint of [...broadcastEndpoints, ...accountEndpoints]) {
    await assert.rejects(() => endpoint.handler({ user: null }), /Нужен вход/);
  }
});

test('queue requires unchanged preview; double-send rejected; dispatcher persists before send', async () => {
  const payload = createPayload();
  const request = createRequest(payload);
  const preview = await (await broadcastEndpoints[0].handler(request)).json();
  await assert.rejects(
    () => broadcastEndpoints[1].handler(createRequest(payload, { hash: 'stale' })),
    /изменились/,
  );
  await broadcastEndpoints[1].handler(createRequest(payload, { hash: preview.hash }));
  assert.equal(payload.campaign.status, 'queued');
  await assert.rejects(
    () => broadcastEndpoints[1].handler(createRequest(payload, { hash: preview.hash })),
    /уже запущена/,
  );
  const messages = [];
  api.sendMessage = async (telegramId, text) => {
    assert.equal(payload.campaign.deliveries[0].state, 'sending');
    messages.push({ telegramId, text });
  };
  await dispatchBroadcasts(payload);
  await dispatchBroadcasts(payload);
  assert.equal(messages.length, 1);
  assert.equal(payload.campaign.status, 'completed');
  assert.equal(payload.campaign.deliveries[0].state, 'sent');
});

test('restart never replays ambiguous in-flight message', async () => {
  const payload = createPayload({
    status: 'sending',
    deliveries: [{ name: 'Анна', telegramId: '100', text: 'Текст', state: 'sending' }],
  });
  api.sendMessage = async () => assert.fail('Ambiguous send must not be replayed');
  await dispatchBroadcasts(payload);
  assert.equal(payload.campaign.deliveries[0].state, 'uncertain');
  assert.equal(payload.campaign.status, 'completed');
});

test('draft protection rejects edits to active campaigns and injected delivery state', () => {
  const hook = Broadcasts.hooks.beforeChange[0];
  assert.throws(
    () =>
      hook({
        data: { message: 'Подмена' },
        originalDoc: { id: 1, status: 'queued' },
        req: { context: {} },
      }),
    /нельзя изменить/,
  );
  assert.throws(() => hook({ data: { status: 'queued' }, req: { context: {} } }), /Запустите/);
  assert.throws(() => hook({ data: { deliveries: [] }, req: { context: {} } }), /Запустите/);
  assert.throws(
    () =>
      hook({
        data: {},
        originalDoc: { updatedAt: 'new' },
        req: { context: { broadcastInternal: true, broadcastRevision: 'old' } },
      }),
    /изменилась/,
  );
});

test('personal peer resolution rejects groups and changed usernames', async () => {
  const client = {
    async getInputEntity() {
      return new Api.InputPeerUser({ userId: bigInteger(100), accessHash: bigInteger(12345) });
    },
  };
  assert.deepEqual(await resolvePersonalPeer(client, 'anna', '100'), {
    userId: '100',
    accessHash: '12345',
  });
  await assert.rejects(() => resolvePersonalPeer(client, 'anna', '200'), /не соответствует/);
  client.getInputEntity = async () => new Api.InputPeerChat({ chatId: bigInteger(1) });
  await assert.rejects(() => resolvePersonalPeer(client, 'group'), /не соответствует/);
});

test('Telegram 429 persists cooldown and resumes without repeating successful deliveries', async () => {
  const { GrammyError } = await import('grammy');
  const payload = createPayload({
    status: 'queued',
    deliveries: [{ name: 'Анна', telegramId: '100', text: 'Текст', state: 'pending' }],
  });
  let attempts = 0;
  api.sendMessage = async () => {
    attempts++;
    throw new GrammyError(
      'Too Many Requests',
      {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 120 },
      },
      'sendMessage',
      {},
    );
  };
  await dispatchBroadcasts(payload);
  assert.equal(payload.campaign.deliveries[0].state, 'pending');
  assert.ok(Date.parse(payload.campaign.retryAt) > Date.now());
  await dispatchBroadcasts(payload);
  assert.equal(attempts, 1);
  payload.campaign.retryAt = new Date(Date.now() - 1000).toISOString();
  api.sendMessage = async () => {
    attempts++;
  };
  await dispatchBroadcasts(payload);
  assert.equal(attempts, 2);
  assert.equal(payload.campaign.deliveries[0].state, 'sent');
});

test('network ambiguity is visible and never automatically resent', async () => {
  const payload = createPayload({
    status: 'queued',
    deliveries: [{ name: 'Анна', telegramId: '100', text: 'Текст', state: 'pending' }],
  });
  let attempts = 0;
  api.sendMessage = async () => {
    attempts++;
    throw new Error('connection dropped');
  };
  await dispatchBroadcasts(payload);
  await dispatchBroadcasts(payload);
  assert.equal(attempts, 1);
  assert.equal(payload.campaign.deliveries[0].state, 'uncertain');
});

test('unknown template variables produce actionable preview errors', async () => {
  const payload = createPayload({ message: 'Привет, {unknown}' });
  await assert.rejects(
    () => broadcastEndpoints[0].handler(createRequest(payload)),
    /Неизвестная переменная: unknown/,
  );
});

test('personal preview includes users before bot activation and deduplicates orders by resolved Telegram ID', async () => {
  const payload = createPayload({ sender: 'account' });
  payload.config = { secret: 'test-only-secret-with-at-least-32-characters' };
  const encryptedSession = encryptSession(
    { apiId: 1234, apiHash: 'a'.repeat(32), session: '' },
    payload.config.secret,
  );
  payload.findGlobal = async () => ({ connected: true, ownerId: '999', encryptedSession });
  payload.orders[2].telegram = 'newuser';
  payload.orders.push({ ...payload.orders[2], id: 4 });
  const mocks = [
    mock.method(TelegramClient.prototype, 'connect', async () => undefined),
    mock.method(TelegramClient.prototype, 'disconnect', async () => undefined),
    mock.method(TelegramClient.prototype, 'getMe', async function () {
      assert.equal(this._requestRetries, 1);
      return new Api.User({ id: bigInteger(999), username: 'brandmasterskaya' });
    }),
    mock.method(TelegramClient.prototype, 'iterDialogs', async function* () {}),
    mock.method(TelegramClient.prototype, 'getInputEntity', async (target) => {
      const id = String(target) === 'newuser' ? '300' : String(target);
      return new Api.InputPeerUser({ userId: bigInteger(id), accessHash: bigInteger(12345) });
    }),
  ];
  try {
    const preview = await prepareBroadcast(payload, payload.campaign);
    assert.deepEqual(
      preview.deliveries.map((delivery) => delivery.telegramId),
      ['100', '200', '300'],
    );
    assert.equal(preview.skipped.length, 0);
    assert.match(preview.deliveries[2].text, new RegExp(`start=${'c'.repeat(32)}`));
  } finally {
    for (const mocked of mocks) mocked.mock.restore();
  }
});

test('approved links remain in the delivery snapshot and reach Bot API as text_link entities', async () => {
  const payload = createPayload({ message: '😀 [Бот]({bot_link})' });
  const preview = await prepareBroadcast(payload, payload.campaign);
  const delivery = preview.deliveries[0];
  assert.equal(delivery.text, '😀 Бот');
  assert.deepEqual(delivery.entities, [
    {
      type: 'text_link',
      offset: 3,
      length: 3,
      url: `https://t.me/my_test_bot?start=${'a'.repeat(32)}`,
    },
  ]);
  payload.campaign.status = 'queued';
  payload.campaign.deliveries = preview.deliveries;
  let sent = false;
  api.sendMessage = async (telegramId, text, options) => {
    sent = true;
    assert.equal(text, '😀 Бот');
    assert.deepEqual(options.entities, delivery.entities);
    assert.equal(options.parse_mode, undefined);
  };
  await dispatchBroadcasts(payload);
  assert.equal(sent, true);
  assert.equal(payload.campaign.deliveries[0].state, 'sent');
});
