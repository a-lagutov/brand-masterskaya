import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const securityPath = '../src/cabinet/security.ts';

/** Imports the cabinet security implementation after proving its presence. */
async function security() {
  assert.doesNotThrow(() => require.resolve(securityPath), 'cabinet security must exist');
  return import(securityPath);
}

test('signed tokens reject tampering, expiry, future issuance and purpose confusion', async () => {
  const { signToken, verifyToken } = await security();
  const secret = 'test-only-secret-for-cabinet-at-least-32-characters';
  const token = signToken(
    { purpose: 'session', memberId: 7, sessionId: 'test-session' },
    secret,
    60,
    1000,
  );
  assert.equal(verifyToken(token, secret, 'session', 1001)?.memberId, 7);
  assert.equal(verifyToken(token, secret, 'playback', 1001), null);
  assert.equal(verifyToken(token, secret, 'session', 1060), null);
  assert.equal(verifyToken(token, secret, 'session', 999), null);
  assert.equal(verifyToken(`${token}x`, secret, 'session', 1001), null);
  assert.equal(
    verifyToken(token, 'different-secret-at-least-32-characters', 'session', 1001),
    null,
  );
  assert.equal(verifyToken('', secret, 'session', 1001), null);
  assert.equal(
    verifyToken(`${token.split('.')[0]}.${'я'.repeat(43)}`, secret, 'session', 1001),
    null,
  );
  assert.throws(() => signToken({ purpose: 'session' }, 'short', 60), /secret/i);
});

test('playback is bound to member, login session, lecture and current video revision', async () => {
  const { playbackMatches } = await security();
  const session = { memberId: 7, sessionId: 'session-one' };
  const token = { ...session, lectureId: 3, revision: 'revision-one' };
  assert.equal(playbackMatches(token, session, 3, 'revision-one'), true);
  assert.equal(playbackMatches(token, { ...session, memberId: 8 }, 3, 'revision-one'), false);
  assert.equal(
    playbackMatches(token, { ...session, sessionId: 'session-two' }, 3, 'revision-one'),
    false,
  );
  assert.equal(playbackMatches(token, session, 4, 'revision-one'), false);
  assert.equal(playbackMatches(token, session, 3, 'revision-two'), false);
});

test('media paths reject traversal, absolute paths and unapproved file types', async () => {
  const { safeMediaName } = await security();
  for (const filename of [
    'manifest.mpd',
    'master.m3u8',
    'video.m3u8',
    'video-init.mp4',
    'video-12.m4s',
  ])
    assert.equal(safeMediaName(filename), true);
  for (const filename of [
    '../secret',
    '/manifest.mpd',
    'video/1.m4s',
    '%2e%2e',
    'source.mp4',
    'keys.json',
    'video-1.m4s?x=1',
  ])
    assert.equal(safeMediaName(filename), false);
});

test('content keys are stable per revision, separated by purpose and never stored in metadata', async () => {
  const { contentKeys } = await security();
  const secret = 'test-only-secret-for-cabinet-at-least-32-characters';
  const keys = contentKeys('revision-one', secret);
  assert.match(keys.key, /^[a-f0-9]{32}$/);
  assert.match(keys.keyId, /^[a-f0-9]{32}$/);
  assert.notEqual(keys.key, keys.keyId);
  assert.deepEqual(contentKeys('revision-one', secret), keys);
  assert.notDeepEqual(contentKeys('revision-two', secret), keys);
});

test('packaging uses bounded shell-free commands and separate encrypted segment outputs', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { packageLecture } = await import('../src/cabinet/processor.ts');
  const directory = await mkdtemp(`${tmpdir()}/cabinet-commands-`);
  const calls = [];
  try {
    await packageLecture(
      '/private/source;echo.mp4',
      'test-revision',
      directory,
      'test-only-cabinet-secret-at-least-32-characters',
      async (...args) => {
        calls.push(args);
        if (calls.length === 2) {
          await writeFile(`${directory}/video.m3u8`, '#EXTM3U\n#EXT-X-ENDLIST\n');
          await writeFile(`${directory}/audio.m3u8`, '#EXTM3U\n#EXT-X-ENDLIST\n');
        }
      },
    );
    assert.equal(calls.length, 2);
    assert.match(
      await readFile(`${directory}/video.m3u8`, 'utf8'),
      /#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="key"/,
    );
    assert.equal(calls[0][1][calls[0][1].indexOf('-i') + 1], '/private/source;echo.mp4');
    assert.equal(calls[0][2].timeout, 3600000);
    assert.ok(calls[1][1].includes('--enable_raw_key_encryption'));
    assert.ok(calls[1][1].includes('--generate_static_live_mpd'));
    assert.equal(calls[1][1][calls[1][1].indexOf('--hls_playlist_type') + 1], 'VOD');
    assert.ok(calls[1][1].includes('manifest.mpd'));
    assert.ok(calls[1][1].includes('master.m3u8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Telegram login verifies signed numeric identity rather than trusting OIDC sub', async () => {
  const { generateKeyPair, SignJWT } = await import('jose');
  const { verifyTelegramIdentity } = await import('../src/cabinet/telegramLogin.ts');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  /** Signs synthetic Telegram claims without any network request or live account. */
  const signed = (claims, audience = 'test-client') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://oauth.telegram.org')
      .setAudience(audience)
      .setSubject('different-oidc-sub')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  const identity = await verifyTelegramIdentity(
    await signed({ id: 900003, name: 'Тест' }),
    'test-client',
    async () => publicKey,
  );
  assert.equal(identity.id, 900003);
  const stringIdentity = await verifyTelegramIdentity(
    await signed({ id: '900003', name: 'Тест' }),
    'test-client',
    async () => publicKey,
  );
  assert.equal(
    stringIdentity.id,
    900003,
    'verified decimal ID strings must normalize to Bot API numbers',
  );
  for (const invalidId of [
    undefined,
    null,
    true,
    0,
    -1,
    1.5,
    '1.5',
    '9e5',
    ' 900003',
    '9007199254740993',
  ]) {
    await assert.rejects(async () =>
      verifyTelegramIdentity(await signed({ id: invalidId }), 'test-client', async () => publicKey),
    );
  }

  await assert.rejects(() =>
    verifyTelegramIdentity('not-a-token', 'test-client', async () => publicKey),
  );
  await assert.rejects(async () =>
    verifyTelegramIdentity(
      await signed({ id: 900003 }, 'another-client'),
      'test-client',
      async () => publicKey,
    ),
  );
  await assert.rejects(async () =>
    verifyTelegramIdentity(await signed({ id: '900003x' }), 'test-client', async () => publicKey),
  );
});

test('bot offers exactly one configured cabinet button and stays unchanged while disabled', async () => {
  const { sendCabinetButton } = await import('../src/cabinet/bot.ts');
  const previousUrl = process.env.CABINET_URL;
  const messages = [];
  const context = {
    reply: async (...args) => {
      messages.push(args);
    },
  };
  try {
    process.env.CABINET_URL = '';
    await sendCabinetButton(context);
    assert.equal(messages.length, 0);
    process.env.CABINET_URL = 'https://cabinet.example.com';
    await sendCabinetButton(context);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0][1].reply_markup.inline_keyboard, [
      [{ text: 'Перейти в личный кабинет', url: 'https://cabinet.example.com/cabinet' }],
    ]);
  } finally {
    if (previousUrl === undefined) delete process.env.CABINET_URL;
    else process.env.CABINET_URL = previousUrl;
  }
});

test('login diagnostics never include credentials, token payloads or profile values', async () => {
  const { loginFailureDetails } = await import('../src/cabinet/loginDiagnostics.ts');
  const failure = {
    code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
    claim: 'aud',
    message: 'fake-private-token',
    payload: { name: 'Fake private profile' },
  };
  assert.deepEqual(loginFailureDetails('identity_verification', 200, failure), {
    stage: 'identity_verification',
    status: 200,
    code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
    claim: 'aud',
  });
  assert.deepEqual(
    loginFailureDetails('token_request', 0, { code: 'private value', claim: 'private claim' }),
    { stage: 'token_request', status: 0, code: 'unclassified' },
  );
});
