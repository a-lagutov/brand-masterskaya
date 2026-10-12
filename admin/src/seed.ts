import type { Payload } from 'payload';

/**
 * Creates the first admin from ADMIN_EMAIL and ADMIN_PASSWORD when there are no admins yet.
 * Without it the panel would offer "create the first user" to anyone who opens it first.
 * @param payload
 */
export async function ensureFirstAdmin(payload: Payload): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    return;
  }
  const admins = await payload.count({ collection: 'users' });
  if (admins.totalDocs === 0) {
    await payload.create({ collection: 'users', data: { email, password, name: 'Администратор' } });
    payload.logger.info(`created the first admin ${email}`);
  }
}
