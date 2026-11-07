import assert from 'node:assert/strict';
import { test } from 'node:test';

// Stub Telegram before importing runtime modules; every delivery stays inside this test process.
process.env.TELEGRAM_BOT_TOKEN = '123:schedule-test-token';
process.env.RUN_BOT = '1';
const { telegramApi } = await import('../src/bot/telegram.ts');
telegramApi().getMe = async () => ({ id: 123, username: 'schedule_test_bot' });
const { broadcastEndpoints, dispatchScheduledBroadcasts } =
  await import('../src/bot/broadcasts.ts');
const { Broadcasts } = await import('../src/collections/Broadcasts.ts');

/** Applies the small Payload predicate subset used by the scheduling engine. */
function matches(document, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'and') return condition.every((clause) => matches(document, clause));
    if (key === 'or') return condition.some((clause) => matches(document, clause));
    if ('equals' in condition) return document[key] === condition.equals;
    if ('in' in condition) return condition.in.includes(document[key]);
    return true;
  });
}

/** Provides durable in-memory documents and a unique occurrence constraint across scheduler ticks. */
function createPayload(changes = {}) {
  const campaign = {
    id: 1,
    title: 'Расписание',
    sender: 'bot',
    audience: 'all',
    payment: 'all',
    message: 'Привет, {name}',
    status: 'scheduled',
    scheduleMode: 'daily',
    scheduledAt: '2030-01-01T07:00:00.000Z',
    nextRunAt: '2030-01-01T07:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
    ...changes,
  };
  const documents = [campaign];
  const members = [{ id: 1, telegramId: '100', displayName: 'Анна', botStarted: true }];
  return {
    campaign,
    documents,
    members,
    logger: { error() {} },
    async find({ collection, where }) {
      return {
        docs: structuredClone(
          collection === 'members'
            ? members
            : collection === 'orders'
              ? []
              : documents.filter((document) => matches(document, where)),
        ),
      };
    },
    async findByID({ id }) {
      return structuredClone(documents.find((document) => document.id === id));
    },
    async create({ data }) {
      assert.ok(
        !documents.some(
          (document) => data.occurrenceKey && document.occurrenceKey === data.occurrenceKey,
        ),
      );
      const document = { ...structuredClone(data), id: documents.length + 1 };
      documents.push(document);
      return structuredClone(document);
    },
    async update({ id, data }) {
      const document = documents.find((candidate) => candidate.id === id);
      Object.assign(document, structuredClone(data));
      return structuredClone(document);
    },
  };
}

/** Builds an authenticated action request without HTTP or a live Telegram transport. */
function request(payload, body = {}) {
  return {
    user: { id: 1, collection: 'users' },
    payload,
    routeParams: { id: '1' },
    json: async () => body,
  };
}

/** Resolves endpoint names independently of registration order. */
function endpoint(action) {
  return broadcastEndpoints.find((candidate) => candidate.path === `/:id/${action}`).handler;
}

test('approval schedules a future draft without queueing a delivery or sending immediately', async () => {
  const payload = createPayload({
    status: 'draft',
    scheduleMode: 'once',
    scheduledAt: '2099-01-01T07:00:00.000Z',
    nextRunAt: null,
  });
  const preview = await (await endpoint('preview')(request(payload))).json();
  await endpoint('send')(request(payload, { hash: preview.hash }));
  assert.equal(payload.campaign.status, 'scheduled');
  assert.equal(payload.campaign.nextRunAt, payload.campaign.scheduledAt);
  assert.equal(payload.campaign.deliveries == null, true);
  await dispatchScheduledBroadcasts(payload, new Date('2098-12-31T00:00:00Z'));
  assert.equal(payload.documents.length, 1);
});

test('each occurrence snapshots current recipients, skips overlaps and does not replay missed slots', async () => {
  const payload = createPayload();
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z'));
  assert.equal(payload.documents.length, 2);
  assert.equal(payload.documents[1].deliveries[0].text, 'Привет, Анна');
  assert.equal(payload.documents[1].sender, 'bot');
  assert.equal(payload.documents[1].parentBroadcast, 1);
  assert.equal(payload.campaign.nextRunAt, '2030-01-02T07:00:00.000Z');
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-04T08:00:00Z'));
  assert.equal(payload.documents.length, 2);
  payload.documents[1].status = 'completed';
  payload.members[0].displayName = 'Новое имя';
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-04T08:00:00Z'));
  assert.equal(payload.documents.length, 3);
  assert.equal(payload.documents[2].deliveries[0].text, 'Привет, Новое имя');
  assert.equal(payload.campaign.nextRunAt, '2030-01-05T07:00:00.000Z');
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-04T08:00:00Z'));
  assert.equal(payload.documents.length, 3);
});

test('restart after child creation advances the schedule without duplicate child creation', async () => {
  const payload = createPayload();
  const update = payload.update;
  let failOnce = true;
  payload.update = async (input) => {
    if (input.id === 1 && input.data.nextRunAt && failOnce) {
      failOnce = false;
      throw new Error('simulated persistence failure');
    }
    return update(input);
  };
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z'));
  assert.equal(payload.documents.length, 2);
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z'));
  assert.equal(payload.documents.length, 2);
  assert.equal(payload.campaign.nextRunAt, '2030-01-02T07:00:00.000Z');
});

test('one-time schedule completes after its child; cancellation stops future runs only', async () => {
  const payload = createPayload({ scheduleMode: 'once' });
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z'));
  assert.equal(payload.documents.length, 2);
  assert.equal(payload.campaign.nextRunAt, null);
  payload.documents[1].status = 'completed';
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-02T07:00:00Z'));
  assert.equal(payload.campaign.status, 'completed');
  const recurring = createPayload();
  await dispatchScheduledBroadcasts(recurring, new Date('2030-01-01T07:00:00Z'));
  await assert.rejects(() => endpoint('cancel')({ user: null }), /Нужен вход/);
  await endpoint('cancel')(request(recurring));
  assert.equal(recurring.campaign.status, 'cancelled');
  assert.equal(recurring.documents[1].status, 'queued');
  await dispatchScheduledBroadcasts(recurring, new Date('2030-01-03T07:00:00Z'));
  assert.equal(recurring.documents.length, 2);
});

test('draft API cannot forge scheduling state or rewrite an approved schedule', () => {
  const hook = Broadcasts.hooks.beforeChange[0];
  for (const data of [
    { nextRunAt: '2099-01-01' },
    { parentBroadcast: 1 },
    { occurrenceKey: 'fake' },
    { scheduledFor: '2099-01-01' },
    { scheduleError: 'fake' },
  ]) {
    assert.throws(() => hook({ data, req: { context: {} } }), /Запустите/);
  }
  assert.throws(
    () =>
      hook({
        data: { scheduledAt: '2099-01-01' },
        originalDoc: { id: 1, status: 'scheduled' },
        req: { context: {} },
      }),
    /нельзя изменить/,
  );
});

// Future audiences may be empty today; approval still authorizes the saved filters for later runs.
test('scheduled approval permits an empty current audience, while immediate sending rejects it', async () => {
  const payload = createPayload({ status: 'draft', scheduledAt: '2099-01-01T07:00:00.000Z' });
  payload.members.length = 0;
  const preview = await (await endpoint('preview')(request(payload))).json();
  await endpoint('send')(request(payload, { hash: preview.hash }));
  assert.equal(payload.campaign.status, 'scheduled');
  const immediate = createPayload({ status: 'draft', scheduleMode: 'now' });
  immediate.members.length = 0;
  const empty = await (await endpoint('preview')(request(immediate))).json();
  await assert.rejects(
    () => endpoint('send')(request(immediate, { hash: empty.hash })),
    /Нет доступных/,
  );
});

test('approval rejects past dates, cancellation rejects drafts, concurrent ticks create one child', async () => {
  const draft = createPayload({ status: 'draft' });
  await assert.rejects(() => endpoint('cancel')(request(draft)), /не включено/);
  draft.campaign.scheduledAt = '2000-01-01T07:00:00.000Z';
  const preview = await (await endpoint('preview')(request(draft))).json();
  await assert.rejects(
    () => endpoint('send')(request(draft, { hash: preview.hash })),
    /будущую дату/,
  );
  const payload = createPayload();
  await Promise.all([
    dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z')),
    dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z')),
  ]);
  assert.equal(payload.documents.length, 2);
});

test('empty occurrences complete without sends; preparation failures stop the schedule visibly', async () => {
  const empty = createPayload({ scheduleUntil: '2030-01-01T07:00:00.000Z' });
  empty.members.length = 0;
  await dispatchScheduledBroadcasts(empty, new Date('2030-01-01T07:00:00Z'));
  assert.equal(empty.documents[1].status, 'completed');
  assert.deepEqual(empty.documents[1].deliveries, []);
  await dispatchScheduledBroadcasts(empty, new Date('2030-01-01T07:01:00Z'));
  assert.equal(empty.campaign.status, 'completed');
  const broken = createPayload({ message: '{unknown}' });
  await dispatchScheduledBroadcasts(broken, new Date('2030-01-01T07:00:00Z'));
  assert.equal(broken.campaign.status, 'cancelled');
  assert.match(broken.campaign.scheduleError, /Неизвестная переменная: unknown/);
  assert.equal(broken.documents.length, 1);
});

// A stop can finish while another schedule is being processed after the scheduler reads its list.
test('scheduler rechecks persisted status before claiming a stale schedule-list entry', async () => {
  const payload = createPayload();
  const find = payload.find;
  payload.find = async (input) => {
    const result = await find(input);
    if (input.where?.status?.equals === 'scheduled') payload.campaign.status = 'cancelled';
    return result;
  };
  await dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z'));
  assert.equal(payload.documents.length, 1);
  assert.equal(payload.campaign.status, 'cancelled');
});

// Personal-account scheduling resolves peers only; transport send methods are never invoked here.
test('personal scheduled runs retain the selected sender and a frozen resolved peer', async () => {
  const { mock } = await import('node:test');
  const { Api, TelegramClient } = await import('teleproto');
  const { default: bigInteger } = await import('big-integer');
  const { encryptSession } = await import('../src/bot/sessionEncryption.ts');
  const payload = createPayload({ sender: 'account' });
  payload.config = { secret: 'isolated-personal-schedule-secret-over-32-characters' };
  const encryptedSession = encryptSession(
    { apiId: 1234, apiHash: 'a'.repeat(32), session: '' },
    payload.config.secret,
  );
  payload.findGlobal = async () => ({ connected: true, ownerId: '999', encryptedSession });
  const peer = new Api.InputPeerUser({ userId: bigInteger(100), accessHash: bigInteger(12345) });
  const mocks = [
    mock.method(TelegramClient.prototype, 'connect', async () => undefined),
    mock.method(TelegramClient.prototype, 'disconnect', async () => undefined),
    mock.method(
      TelegramClient.prototype,
      'getMe',
      async () => new Api.User({ id: bigInteger(999), username: 'brandmasterskaya' }),
    ),
    mock.method(TelegramClient.prototype, 'iterDialogs', async function* () {
      yield { isUser: true, inputEntity: peer };
    }),
    mock.method(TelegramClient.prototype, 'getInputEntity', async () => peer),
    mock.method(TelegramClient.prototype, 'sendMessage', async () =>
      assert.fail('Scheduling must not send Telegram messages'),
    ),
  ];
  try {
    await dispatchScheduledBroadcasts(payload, new Date('2030-01-01T07:00:00Z'));
    assert.equal(payload.documents[1].sender, 'account');
    assert.deepEqual(payload.documents[1].deliveries[0].peer, {
      userId: '100',
      accessHash: '12345',
    });
    assert.equal(payload.documents[1].deliveries[0].state, 'pending');
  } finally {
    for (const mocked of mocks) mocked.mock.restore();
  }
});

// Payload uses the document update predicate to disable ordinary editing after explicit approval.
test('active schedule forms use draft-only update permissions', () => {
  assert.deepEqual(Broadcasts.access.update({ req: { user: { id: 1 } } }), {
    status: { equals: 'draft' },
  });
  assert.equal(Broadcasts.access.update({ req: { user: null } }), false);
});

// Approving an empty future audience must still validate the template before any automatic run.
test('empty-audience schedules reject unknown variables and unsafe links at preview', async () => {
  for (const message of ['Привет, {unknown}', '[Сайт](javascript:alert)']) {
    const payload = createPayload({
      status: 'draft',
      message,
      scheduledAt: '2099-01-01T07:00:00.000Z',
    });
    payload.members.length = 0;
    await assert.rejects(() => endpoint('preview')(request(payload)), /переменная|адрес ссылки/);
    assert.equal(payload.campaign.status, 'draft');
  }
});
