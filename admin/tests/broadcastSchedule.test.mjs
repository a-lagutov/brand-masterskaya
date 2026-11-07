import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextBroadcastOccurrence,
  validateBroadcastSchedule,
} from '../src/bot/broadcastSchedule.ts';

// Calendar tests use fixed UTC instants representing the Moscow time shown in the form.
test('one-time schedule has no recurrence; daily and weekly keep Moscow wall time', () => {
  const start = '2026-12-31T20:30:00.000Z';
  assert.equal(nextBroadcastOccurrence({ scheduleMode: 'once', scheduledAt: start }, start), null);
  assert.equal(
    nextBroadcastOccurrence({ scheduleMode: 'daily', scheduledAt: start }, start),
    '2027-01-01T20:30:00.000Z',
  );
  assert.equal(
    nextBroadcastOccurrence({ scheduleMode: 'weekly', scheduledAt: start }, start),
    '2027-01-07T20:30:00.000Z',
  );
});

test('monthly schedule clamps short months without drifting away from original day', () => {
  const schedule = { scheduleMode: 'monthly', scheduledAt: '2028-01-31T06:00:00.000Z' };
  assert.equal(nextBroadcastOccurrence(schedule, schedule.scheduledAt), '2028-02-29T06:00:00.000Z');
  assert.equal(
    nextBroadcastOccurrence(schedule, '2028-02-29T06:00:00.000Z'),
    '2028-03-31T06:00:00.000Z',
  );
  assert.equal(
    nextBroadcastOccurrence(schedule, '2029-01-31T06:00:00.000Z'),
    '2029-02-28T06:00:00.000Z',
  );
});

test('recurrence skips missed slots, respects inclusive end and preserves start before first slot', () => {
  const schedule = {
    scheduleMode: 'daily',
    scheduledAt: '2026-11-10T07:00:00.000Z',
    scheduleUntil: '2026-11-15T07:00:00.000Z',
  };
  assert.equal(nextBroadcastOccurrence(schedule, '2026-11-01T00:00:00Z'), schedule.scheduledAt);
  assert.equal(nextBroadcastOccurrence(schedule, '2026-11-14T08:00:00Z'), schedule.scheduleUntil);
  assert.equal(nextBroadcastOccurrence(schedule, schedule.scheduleUntil), null);
});

test('approval validates mode, future start and end order; immediate drafts remain compatible', () => {
  const now = new Date('2026-11-07T00:00:00Z');
  assert.equal(validateBroadcastSchedule({}, now), null);
  assert.equal(validateBroadcastSchedule({ scheduleMode: 'now' }, now), null);
  assert.equal(
    validateBroadcastSchedule({ scheduleMode: 'daily', scheduledAt: '2026-11-08T00:00:00Z' }, now),
    null,
  );
  for (const schedule of [
    { scheduleMode: 'invalid' },
    { scheduleMode: 'daily' },
    { scheduleMode: 'once', scheduledAt: 'wrong' },
    { scheduleMode: 'once', scheduledAt: now.toISOString() },
    {
      scheduleMode: 'daily',
      scheduledAt: '2026-11-08T00:00:00Z',
      scheduleUntil: '2026-11-07T00:00:00Z',
    },
    { scheduleMode: 'daily', scheduledAt: '2026-11-08T00:00:00Z', scheduleUntil: 'wrong' },
  ])
    assert.equal(typeof validateBroadcastSchedule(schedule, now), 'string');
});

// End dates belong only to repeated schedules; hidden stale values must not affect a one-time date.
test('one-time mode ignores a previously saved repeat end; unknown calendar modes do not run', () => {
  const once = {
    scheduleMode: 'once',
    scheduledAt: '2030-01-31T22:30:00.000Z',
    scheduleUntil: '2029-01-01T00:00:00Z',
  };
  assert.equal(validateBroadcastSchedule(once, new Date('2026-01-01')), null);
  assert.equal(nextBroadcastOccurrence(once, '2026-01-01T00:00:00Z'), once.scheduledAt);
  assert.equal(
    nextBroadcastOccurrence({ ...once, scheduleMode: 'invalid' }, '2026-01-01T00:00:00Z'),
    null,
  );
  assert.equal(
    nextBroadcastOccurrence(
      { scheduleMode: 'monthly', scheduledAt: '2028-01-30T22:30:00.000Z' },
      '2028-01-30T22:30:00.000Z',
    ),
    '2028-02-28T22:30:00.000Z',
  );
  assert.equal(nextBroadcastOccurrence({}, 'invalid'), null);
});
