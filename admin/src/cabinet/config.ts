import path from 'node:path';

/** Resolves private storage outside the public directory and outside generated deployment files. */
export function videoDirectory(): string {
  return path.resolve(
    process.env.LECTURE_STORAGE_DIR || path.join(process.cwd(), 'media', 'lectures'),
  );
}

/** Uses only an explicitly configured origin; request Host headers never control auth redirects. */
export function cabinetOrigin(): string {
  const address = new URL(process.env.CABINET_URL || 'http://localhost:3000');
  if (
    address.protocol !== 'https:' &&
    !(address.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(address.hostname))
  ) {
    throw new Error('CABINET_URL requires HTTPS');
  }
  return address.origin;
}

/** Keeps cabinet signing and media encryption independent of Payload admin and Telegram sessions. */
export function cabinetSecret(): string {
  const secret = process.env.CABINET_SECRET || '';
  if (secret.length < 32) throw new Error('Configure CABINET_SECRET with at least 32 characters');
  return secret;
}

/** Returns a bot button only after the owner configures the environment-specific cabinet URL. */
export function cabinetLink(): string | null {
  if (!process.env.CABINET_URL) return null;
  try {
    return new URL('/cabinet', cabinetOrigin()).href;
  } catch {
    return null;
  }
}
