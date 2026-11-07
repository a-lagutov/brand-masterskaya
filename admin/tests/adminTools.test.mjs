import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOrderTable } from '../src/bot/bulkOrders.ts';
import { filterRecipientRows, updateRecipientSelection } from '../src/bot/recipientSelection.ts';
import { fillText } from '../src/bot/texts.ts';
import {
  serializeMessageDocument,
  initialMessageEditorState,
} from '../src/editor/messageDocument.ts';

const products = [
  { id: 1, key: 'watch', title: 'Только смотрю' },
  { id: 2, key: 'work', title: 'Работаю' },
];

test('bulk parser accepts spreadsheet rows, Russian dates, decimal amounts and known products', () => {
  const result = parseOrderTable(
    'Имя\tEmail\tТелефон\tTelegram\tТарифы\tСумма\tОплачен\nАнна\tanna@example.com\t+79001234567\t@anna\twatch|work\t1 250,50\t07.11.2026',
    products,
    [],
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].total, 1250.5);
  assert.deepEqual(result.rows[0].products, [1, 2]);
  assert.equal(result.rows[0].paidAt, '2026-11-06T21:00:00.000Z');
});

test('bulk parser supports quoted CSV, rejects bad rows and leaves contacts as data', () => {
  const valid = parseOrderTable(
    'name;email;total\n"Анна; Иванова";anna@example.com;100',
    products,
    [1],
  );
  assert.equal(valid.rows[0].name, 'Анна; Иванова');
  assert.deepEqual(valid.rows[0].products, [1]);
  const invalid = parseOrderTable(
    'Имя\tEmail\tТарифы\tСумма\tОплачен\nАнна\twrong\tunknown\t-10\t31.02.2026',
    products,
    [],
  );
  assert.ok(invalid.errors.length > 0);
  assert.equal(invalid.rows.length, 0);
});

test('recipient table payment and product filters match one order, not different orders', () => {
  const members = [
    { id: 1, telegramId: '100', displayName: 'Анна' },
    { id: 2, telegramId: '200', displayName: 'Иван' },
  ];
  const orders = [
    { id: 1, name: 'Анна', member: 1, products: [1], paidAt: '2026-11-07' },
    { id: 2, name: 'Анна', member: 1, products: [2], paidAt: null },
    { id: 3, name: 'Иван', member: 2, products: [2], paidAt: '2026-11-07' },
  ];
  const filtered = filterRecipientRows('members', members, orders, products, {
    payment: 'paid',
    products: [2],
    search: '',
  });
  assert.deepEqual(
    filtered.map((row) => row.id),
    [2],
  );
  assert.deepEqual(
    filterRecipientRows('orders', members, orders, products, {
      payment: 'unpaid',
      products: [2],
      search: 'анна',
    }).map((row) => row.id),
    [2],
  );
  assert.deepEqual(updateRecipientSelection([1, 9], [1, 2], true), [1, 9, 2]);
  assert.deepEqual(updateRecipientSelection([1, 9, 2], [1, 2], false), [9]);
});

test('bot text rich editor sends formatted variables rather than serialized JSON', () => {
  const state = initialMessageEditorState('Привет, {name}! [Сайт]({site})');
  state.root.children[0].children[0].format = 1;
  const message = fillText(
    serializeMessageDocument(state),
    { contact: 'hello@example.com' },
    { name: '<Анна>' },
  );
  assert.match(message, /<b>Привет, &lt;Анна&gt;! <\/b>/);
  assert.match(message, /<a href="https:\/\//);
  assert.doesNotMatch(message, /editorState/);
});
