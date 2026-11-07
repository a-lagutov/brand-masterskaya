import assert from 'node:assert/strict';
import { test } from 'node:test';
import { botStartLink, renderMessage, selectRecipients } from '../src/bot/messaging.ts';

/** Builds an order with predictable contact details. */
function makeOrder(changes = {}) {
  return {
    id: 1,
    orderId: 'a'.repeat(32),
    name: 'Анна',
    email: 'anna@example.com',
    member: 1,
    products: [7],
    paidAt: '2026-11-01',
    ...changes,
  };
}
const members = [
  { id: 1, telegramId: '123', displayName: 'Анна', username: 'anna', botStarted: true },
  { id: 2, telegramId: '456', displayName: 'Иван', botStarted: false },
];

test('order links retain purchase claim; generic links do not grant access', () => {
  assert.equal(
    botStartLink('my_bot', 'a'.repeat(32)),
    `https://t.me/my_bot?start=${'a'.repeat(32)}`,
  );
  assert.equal(botStartLink('@my_bot'), 'https://t.me/my_bot');
  assert.throws(() => botStartLink('bad/url'));
  assert.throws(() => botStartLink('my_bot', '../bad'));
});

test('templates replace variables once, retain plain text and reject unknown names', () => {
  assert.equal(
    renderMessage('Привет, {name}! {bot_link}', {
      name: '{email} <Анна>',
      bot_link: 'https://t.me/my_bot',
    }),
    'Привет, {email} <Анна>! https://t.me/my_bot',
  );
  assert.throws(() => renderMessage('{missing}', {}), /missing/);
  assert.throws(() => renderMessage('{name}', { name: 'x'.repeat(4097) }));
  assert.throws(() => renderMessage('  ', {}));
});

test('selected members, product and payment filters intersect; duplicate orders yield one recipient', () => {
  const orders = [
    makeOrder(),
    makeOrder({ id: 2 }),
    makeOrder({ id: 3, member: 2, products: [8], paidAt: null }),
  ];
  const recipients = selectRecipients(members, orders, {
    audience: 'selected',
    members: [1, 2],
    products: [7],
    payment: 'paid',
  });
  assert.deepEqual(
    recipients.map((recipient) => recipient.member.id),
    [1],
  );
  assert.deepEqual(
    selectRecipients(members, orders, {
      audience: 'selected',
      members: [],
      products: [],
      payment: 'all',
    }),
    [],
  );
  assert.equal(
    selectRecipients(members, orders, { audience: 'all', payment: 'unpaid', products: [] })[0]
      .member.id,
    2,
  );
});
