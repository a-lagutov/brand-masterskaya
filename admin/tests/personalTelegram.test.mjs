import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { Api, TelegramClient } from 'teleproto';
import bigInteger from 'big-integer';
import { accountEndpoints, telegramErrorCode } from '../src/bot/personalTelegram.ts';
import { decryptSession } from '../src/bot/sessionEncryption.ts';

/** Creates a private account store without contacting Telegram or writing real credentials. */
function accountRequest(input) {
  const account = { connected: false };
  const secret = 'test-only-secret-with-at-least-32-characters';
  const request = {
    user: { id: 1, collection: 'users' },
    json: async () => input,
    payload: {
      config: { secret },
      async findGlobal() {
        return { ...account };
      },
      async updateGlobal({ data }) {
        Object.assign(account, data);
        return { ...account };
      },
    },
  };
  return { request, account, secret };
}

test('personal login stores encrypted challenge, handles 2FA and clears temporary credentials', async () => {
  const { request, account, secret } = accountRequest({
    apiId: 1234,
    apiHash: 'a'.repeat(32),
    phone: '+79001234567',
  });
  const mocks = [
    mock.method(TelegramClient.prototype, 'connect', async () => undefined),
    mock.method(TelegramClient.prototype, 'disconnect', async () => undefined),
    mock.method(TelegramClient.prototype, 'sendCode', async () => ({
      phoneCodeHash: 'private-code-hash',
    })),
    mock.method(TelegramClient.prototype, 'invoke', async () => {
      throw Object.assign(new Error('2FA required'), { errorMessage: 'SESSION_PASSWORD_NEEDED' });
    }),
    mock.method(TelegramClient.prototype, 'signInWithPassword', async () => undefined),
    mock.method(
      TelegramClient.prototype,
      'getMe',
      async () => new Api.User({ id: bigInteger(123), username: 'brandmasterskaya' }),
    ),
  ];
  try {
    const response = await accountEndpoints[0].handler(request);
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(await response.json()).includes('private-code-hash'), false);
    assert.equal(account.encryptedSession.includes('private-code-hash'), false);
    const challenge = decryptSession(account.encryptedSession, secret);
    assert.equal(challenge.phoneCodeHash, 'private-code-hash');
    request.user.id = 2;
    await assert.rejects(() => accountEndpoints[1].handler(request), /новый код/);
    request.user.id = 1;
    request.json = async () => ({ code: '12345' });
    const passwordStep = await (await accountEndpoints[1].handler(request)).json();
    assert.equal(passwordStep.passwordRequired, true);
    request.json = async () => ({ code: '12345', password: 'private-password' });
    const completed = await (await accountEndpoints[1].handler(request)).json();
    assert.equal(completed.connected, true);
    assert.equal(account.username, 'brandmasterskaya');
    const stored = decryptSession(account.encryptedSession, secret);
    assert.equal(stored.phoneCodeHash, undefined);
    assert.equal(stored.phone, undefined);
    assert.equal(stored.password, undefined);
  } finally {
    for (const mocked of mocks) mocked.mock.restore();
  }
});

test('login challenges belong to one administrator and reject malformed application credentials', async () => {
  const { request } = accountRequest({ apiId: 1, apiHash: 'wrong', phone: '+79001234567' });
  await assert.rejects(() => accountEndpoints[0].handler(request), /Проверьте/);
  await assert.rejects(() => accountEndpoints[1].handler(request), /новый код/);
  assert.equal(
    telegramErrorCode(new Error('secret apiHash and session')),
    'TELEGRAM_CONNECTION_FAILED',
  );
  assert.equal(telegramErrorCode({ errorMessage: 'FLOOD_WAIT_30' }), 'FLOOD_WAIT_30');
});

test('personal-account sends convert text links to MTProto entities without parsing user text', async () => {
  const { sendPersonalMessage } = await import('../src/bot/personalTelegram.ts');
  let sent = false;
  const client = {
    async sendMessage(peer, options) {
      sent = true;
      assert.equal(peer.userId.toString(), '123');
      assert.equal(options.message, '😀 Бот');
      assert.equal(options.parseMode, false);
      assert.equal(options.formattingEntities.length, 1);
      const entity = options.formattingEntities[0];
      assert.ok(entity instanceof Api.MessageEntityTextUrl);
      assert.equal(entity.offset, 3);
      assert.equal(entity.length, 3);
      assert.equal(entity.url, 'https://t.me/test_bot');
    },
  };
  await sendPersonalMessage(client, { userId: '123', accessHash: '456' }, '😀 Бот', [
    { type: 'text_link', offset: 3, length: 3, url: 'https://t.me/test_bot' },
  ]);
  assert.equal(sent, true);
});

test('all toolbar formats map to personal-account Telegram entities', async () => {
  const { sendPersonalMessage } = await import('../src/bot/personalTelegram.ts');
  const entities = [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'spoiler',
    'code',
    'blockquote',
  ].map((type) => ({ type, offset: 0, length: 1 }));
  entities.push({
    type: 'date_time',
    offset: 0,
    length: 1,
    unix_time: 1794000000,
    date_time_format: 'dt',
  });
  const client = {
    async sendMessage(peer, options) {
      assert.deepEqual(
        options.formattingEntities.map((entity) => entity.className),
        [
          'MessageEntityBold',
          'MessageEntityItalic',
          'MessageEntityUnderline',
          'MessageEntityStrike',
          'MessageEntitySpoiler',
          'MessageEntityCode',
          'MessageEntityBlockquote',
          'MessageEntityFormattedDate',
        ],
      );
      assert.equal(options.formattingEntities.at(-1).date, 1794000000);
    },
  };
  await sendPersonalMessage(client, { userId: '123', accessHash: '456' }, 'x', entities);
});
