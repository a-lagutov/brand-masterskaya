import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptSession, decryptSession } from '../src/bot/sessionEncryption.ts';

test('session encryption authenticates secret and ciphertext without disclosing credentials', () => {
  const secret = 'a'.repeat(32);
  const credentials = { session: 'private-session', apiHash: 'private-hash' };
  const encrypted = encryptSession(credentials, secret);
  assert.deepEqual(decryptSession(encrypted, secret), credentials);
  assert.equal(encrypted.includes(credentials.session), false);
  assert.notEqual(encryptSession(credentials, secret), encrypted);
  assert.throws(() => decryptSession(encrypted, 'b'.repeat(32)));
  const modified = Buffer.from(encrypted, 'base64');
  modified[30] ^= 1;
  assert.throws(() => decryptSession(modified.toString('base64'), secret));
  assert.throws(() => encryptSession(credentials, 'short'));
});
