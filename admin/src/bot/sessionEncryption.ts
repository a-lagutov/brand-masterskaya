import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Encrypts private Telegram credentials with an authenticated key derived from Payload's secret. */
export function encryptSession(value: unknown, secret: string): string {
  if (secret.length < 32)
    throw new Error('Для подключения Telegram нужен PAYLOAD_SECRET длиной от 32 символов.');
  const key = createHash('sha256').update(`telegram-session:${secret}`).digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Verifies and decrypts a stored session; tampered values fail closed. */
export function decryptSession<T>(value: string, secret: string): T {
  const data = Buffer.from(value, 'base64');
  const key = createHash('sha256').update(`telegram-session:${secret}`).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'),
  ) as T;
}
