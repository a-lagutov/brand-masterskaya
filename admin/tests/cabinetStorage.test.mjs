import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const directory = await mkdtemp(path.join(os.tmpdir(), 'brand-cabinet-storage-'));
process.env.DATABASE_URL = `file:${path.join(directory, 'test.db')}`;
process.env.PAYLOAD_SECRET = 'test-only-payload-secret-at-least-32-characters';
process.env.CABINET_SECRET = 'test-only-cabinet-secret-at-least-32-characters';
process.env.LECTURE_STORAGE_DIR = path.join(directory, 'videos');
process.env.NODE_ENV = 'production';
for (const name of [
  'RUN_BOT',
  'RUN_LECTURE_WORKER',
  'TELEGRAM_BOT_TOKEN',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ORDERS_DIR',
  'PRICES_FILE',
  'PRICE_OVERRIDES_FILE',
  'PROMO_CODES_FILE',
  'SITE_SETTINGS_FILE',
])
  process.env[name] = '';

test('production migrations isolate lecture metadata, enforce group revocation and preserve existing data', async () => {
  const { getPayload } = await import('payload');
  const { default: config } = await import('../src/payload.config.ts');
  const { authorizedLecture, memberGroupIds } = await import('../src/cabinet/access.ts');
  const { signToken } = await import('../src/cabinet/security.ts');
  const { playbackLecture } = await import('../src/cabinet/playback.ts');
  const payload = await getPayload({ config });
  try {
    const admin = await payload.create({
      collection: 'users',
      data: { email: 'cabinet-admin@example.com', password: 'test-only-password-12345' },
    });
    const user = { ...admin, collection: 'users' };
    const member = await payload.create({
      collection: 'members',
      data: { telegramId: '900001', displayName: 'Тестовый участник' },
    });
    const preservedOrder = await payload.create({
      collection: 'orders',
      data: {
        name: 'Тестовый заказ',
        member: member.id,
        total: 100,
        paidAt: '2026-11-08T00:00:00.000Z',
      },
    });
    const outsider = await payload.create({
      collection: 'members',
      data: { telegramId: '900002', displayName: 'Другой участник' },
    });
    const group = await payload.create({
      collection: 'learning-groups',
      data: { title: 'Тестовая группа', members: [member.id] },
    });
    const lecture = await payload.create({
      collection: 'lectures',
      data: {
        title: 'Лекция для теста',
        groups: [group.id],
        published: true,
        revision: '11111111-1111-4111-8111-111111111111',
        processingStatus: 'ready',
      },
      file: {
        name: 'test.mp4',
        data: await readFile(new URL('./fixtures/lecture.mp4', import.meta.url)),
        mimetype: 'video/mp4',
        size: 0,
      },
    });
    assert.equal(lecture.processingStatus, 'pending');
    assert.notEqual(lecture.revision, '11111111-1111-4111-8111-111111111111');
    assert.equal(await authorizedLecture(payload, member.id, lecture.id), null);
    await payload.update({
      collection: 'lectures',
      id: lecture.id,
      data: { processingStatus: 'ready' },
      context: { lectureWorker: true },
    });
    const ready = await authorizedLecture(payload, member.id, lecture.id);
    assert.equal(ready.title, 'Лекция для теста');
    assert.equal(await authorizedLecture(payload, outsider.id, lecture.id), null);
    assert.deepEqual(await memberGroupIds(payload, member.id), [group.id]);
    for (const collection of ['lectures', 'learning-groups']) {
      await assert.rejects(
        () => payload.find({ collection, overrideAccess: false }),
        /not allowed|Forbidden/i,
      );
      await assert.rejects(
        () => payload.create({ collection, overrideAccess: false, data: { title: 'Запрещено' } }),
        /not allowed|Forbidden/i,
      );
    }
    const visibleAdmin = await payload.findByID({
      collection: 'lectures',
      id: lecture.id,
      user,
      overrideAccess: false,
    });
    assert.equal(visibleAdmin.revision, undefined);
    const session = { purpose: 'session', memberId: member.id, sessionId: 'browser-one' };
    const token = signToken(
      {
        purpose: 'playback',
        memberId: member.id,
        sessionId: 'browser-one',
        lectureId: lecture.id,
        revision: ready.revision,
      },
      process.env.CABINET_SECRET,
      600,
    );
    assert.equal((await playbackLecture(payload, session, lecture.id, token)).id, lecture.id);
    assert.equal(
      await playbackLecture(payload, { ...session, sessionId: 'browser-two' }, lecture.id, token),
      null,
    );
    await payload.update({ collection: 'learning-groups', id: group.id, data: { members: [] } });
    assert.equal(await playbackLecture(payload, session, lecture.id, token), null);
    await payload.update({
      collection: 'learning-groups',
      id: group.id,
      data: { members: [member.id] },
    });
    // Product access requires this member's paid, active order for the selected elective.
    const elective = await payload.create({
      collection: 'products',
      data: { key: 'test-elective', title: 'Факультатив', kind: 'elective' },
    });
    const otherElective = await payload.create({
      collection: 'products',
      data: { key: 'test-other', title: 'Другой факультатив', kind: 'elective' },
    });
    await payload.update({
      collection: 'lectures',
      id: lecture.id,
      data: { groups: [], products: [elective.id] },
    });
    const electiveOrder = await payload.create({
      collection: 'orders',
      data: { name: 'Факультатив', member: member.id, products: [elective.id], total: 100 },
    });
    await payload.create({
      collection: 'orders',
      data: {
        name: 'Другой факультатив',
        member: member.id,
        products: [otherElective.id],
        total: 100,
        paidAt: '2026-11-08T00:00:00.000Z',
      },
    });
    await payload.create({
      collection: 'orders',
      data: {
        name: 'Чужой заказ',
        member: outsider.id,
        products: [elective.id],
        total: 100,
        paidAt: '2026-11-08T00:00:00.000Z',
      },
    });
    assert.equal(await authorizedLecture(payload, member.id, lecture.id), null);
    await payload.update({
      collection: 'orders',
      id: electiveOrder.id,
      data: { paidAt: '2026-11-08T00:00:00.000Z' },
    });
    assert.equal((await playbackLecture(payload, session, lecture.id, token)).id, lecture.id);
    const { memberProductIds, lectureFilter } = await import('../src/cabinet/access.ts');
    const productIds = await memberProductIds(payload, member.id);
    const catalogue = await payload.find({
      collection: 'lectures',
      where: lectureFilter([], productIds),
      depth: 0,
    });
    assert.deepEqual(
      catalogue.docs.map((document) => document.id),
      [lecture.id],
    );
    await payload.update({
      collection: 'orders',
      id: electiveOrder.id,
      data: { member: outsider.id },
    });
    assert.equal(await playbackLecture(payload, session, lecture.id, token), null);
    await payload.update({
      collection: 'orders',
      id: electiveOrder.id,
      data: { member: member.id },
    });
    assert.equal((await playbackLecture(payload, session, lecture.id, token)).id, lecture.id);
    await payload.update({ collection: 'orders', id: electiveOrder.id, data: { paidAt: null } });
    assert.equal(await playbackLecture(payload, session, lecture.id, token), null);
    await payload.update({
      collection: 'orders',
      id: electiveOrder.id,
      data: { paidAt: '2026-11-08T00:00:00.000Z', deletedAt: '2026-11-08T01:00:00.000Z' },
    });
    assert.equal(await playbackLecture(payload, session, lecture.id, token), null);
    await payload.update({
      collection: 'lectures',
      id: lecture.id,
      data: { groups: [group.id], products: [] },
    });
    assert.equal((await playbackLecture(payload, session, lecture.id, token)).id, lecture.id);
    await payload.update({ collection: 'lectures', id: lecture.id, data: { groups: [] } });
    assert.equal(await authorizedLecture(payload, member.id, lecture.id), null);
    await payload.update({
      collection: 'lectures',
      id: lecture.id,
      data: { groups: [group.id], published: false },
    });
    assert.equal(await playbackLecture(payload, session, lecture.id, token), null);
    await payload.create({
      collection: 'payload-locked-documents',
      data: {
        document: { relationTo: 'lectures', value: lecture.id },
        user: { relationTo: 'users', value: admin.id },
      },
    });
    // Simulate a replacement committed after the worker's last source check, before publication.
    const fakeBinary = path.join(directory, 'fake-video-tool.cjs');
    await writeFile(
      fakeBinary,
      `#!/usr/bin/env node
const fileSystem = require('node:fs');
fileSystem.writeFileSync('encoded.mp4', 'synthetic');
fileSystem.writeFileSync('video.m3u8', '#EXTM3U');
fileSystem.writeFileSync('audio.m3u8', '#EXTM3U');
fileSystem.writeFileSync('manifest.mpd', '<MPD/>');
process.stderr.write('Duration: 00:01:40.00\\n');
process.stdout.write('out_time_us=50000000\\n');
`,
      { mode: 0o700 },
    );
    process.env.FFMPEG_PATH = fakeBinary;
    process.env.SHAKA_PACKAGER_PATH = fakeBinary;
    await payload.update({
      collection: 'lectures',
      id: lecture.id,
      data: { processingStatus: 'pending' },
      context: { lectureWorker: true },
    });
    const originalFindById = payload.findByID.bind(payload);
    let lectureReads = 0;
    const replacementRevision = '22222222-2222-4222-8222-222222222222';
    payload.findByID = async (options) => {
      const document = await originalFindById(options);
      if (options.collection === 'lectures' && ++lectureReads === 2) {
        const { sql } = await import('@payloadcms/db-sqlite');
        await payload.db.drizzle.run(
          sql`UPDATE lectures SET revision = ${replacementRevision}, processing_status = 'pending' WHERE id = ${lecture.id};`,
        );
      }
      return document;
    };
    try {
      const { processNextLecture } = await import('../src/cabinet/processor.ts');
      assert.equal(await processNextLecture(payload), true);
    } finally {
      payload.findByID = originalFindById;
    }
    const replacement = await payload.findByID({
      collection: 'lectures',
      id: lecture.id,
      depth: 0,
    });
    assert.equal(replacement.revision, replacementRevision);
    assert.equal(
      replacement.processingStatus,
      'pending',
      'old job must never publish a replacement upload',
    );
    const { processNextLecture } = await import('../src/cabinet/processor.ts');
    assert.equal(await processNextLecture(payload), true);
    const prepared = await payload.findByID({ collection: 'lectures', id: lecture.id });
    assert.equal(prepared.processingStatus, 'ready');
    assert.equal(prepared.processingProgress, 100);
    const { sql: leaseSql } = await import('@payloadcms/db-sqlite');
    await payload.db.drizzle.run(leaseSql`UPDATE lectures SET processing_status = 'processing',
      processing_job = 'active-worker', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ${lecture.id}`);
    assert.equal(await processNextLecture(payload), false, 'a live lease must not be reclaimed');
    await payload.db.drizzle
      .run(leaseSql`UPDATE lectures SET updated_at = '2000-01-01T00:00:00.000Z'
      WHERE id = ${lecture.id}`);
    assert.equal(await processNextLecture(payload), true, 'an interrupted worker must be retried');
    const recovered = await payload.findByID({ collection: 'lectures', id: lecture.id });
    assert.equal(recovered.processingStatus, 'ready');
    assert.equal(recovered.processingProgress, 100);
    assert.notEqual(recovered.processingJob, 'active-worker');
    const progressMigration = await import('../src/migrations/20261108_054116_lecture_progress.ts');
    const productMigration = await import('../src/migrations/20261108_051734_lecture_products.ts');
    await payload.update({
      collection: 'lectures',
      id: lecture.id,
      data: { products: [elective.id] },
    });
    await progressMigration.down({ db: payload.db.drizzle, payload, req: {} });
    await productMigration.down({ db: payload.db.drizzle, payload, req: {} });
    const { sql } = await import('@payloadcms/db-sqlite');
    const retainedGroups = await payload.db.drizzle.all(
      sql`SELECT learning_groups_id FROM lectures_rels WHERE parent_id = ${lecture.id} AND path = 'groups'`,
    );
    assert.equal(retainedGroups[0].learning_groups_id, group.id);
    const removedProducts = await payload.db.drizzle.all(
      sql`SELECT id FROM lectures_rels WHERE path = 'products'`,
    );
    assert.equal(removedProducts.length, 0);
    const migration = await import('../src/migrations/20261108_033144_lecture_cabinet.ts');
    await migration.down({ db: payload.db.drizzle, payload, req: {} });
    await migration.up({ db: payload.db.drizzle, payload, req: {} });
    await productMigration.up({ db: payload.db.drizzle, payload, req: {} });
    await progressMigration.up({ db: payload.db.drizzle, payload, req: {} });
    assert.equal(
      (await payload.findByID({ collection: 'orders', id: preservedOrder.id })).total,
      100,
    );
    assert.equal(
      (await payload.findByID({ collection: 'members', id: member.id })).telegramId,
      '900001',
    );
    assert.equal(
      (await payload.findByID({ collection: 'users', id: admin.id })).email,
      'cabinet-admin@example.com',
    );
  } finally {
    await payload.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
