import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLinkedMessage } from '../src/bot/messaging.ts';

test('text links hide URLs, substitute variables and use UTF-16 offsets after emoji', () => {
  const rendered = renderLinkedMessage(
    '😀 Привет, {name}! [Бот]({bot_link}) и [Сайт](https://example.com/path_(one))',
    { name: 'Анна', bot_link: 'https://t.me/test_bot?start=abc' },
  );
  assert.equal(rendered.text, '😀 Привет, Анна! Бот и Сайт');
  assert.deepEqual(rendered.entities, [
    {
      type: 'text_link',
      offset: '😀 Привет, Анна! '.length,
      length: 3,
      url: 'https://t.me/test_bot?start=abc',
    },
    {
      type: 'text_link',
      offset: '😀 Привет, Анна! Бот и '.length,
      length: 4,
      url: 'https://example.com/path_(one)',
    },
  ]);
});

test('variable contents stay literal and cannot inject text-link syntax', () => {
  const rendered = renderLinkedMessage('{name} [{name}]({bot_link})', {
    name: '[подмена](https://other.example)',
    bot_link: 'https://t.me/test_bot',
  });
  assert.equal(rendered.text, '[подмена](https://other.example) [подмена](https://other.example)');
  assert.equal(rendered.entities.length, 1);
  assert.equal(rendered.entities[0].offset, '[подмена](https://other.example) '.length);
  assert.equal(rendered.entities[0].url, 'https://t.me/test_bot');
});

test('rejects unsafe, missing and malformed link targets before queueing', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///etc/passwd',
    '',
    'not-a-url',
    'https://',
  ]) {
    assert.throws(() => renderLinkedMessage('[Текст]({url})', { url }), /ссылк/i);
  }
  assert.throws(() => renderLinkedMessage('[Текст](https://example.com', {}), /ссылк/i);
  assert.throws(() => renderLinkedMessage('[{name}](https://example.com)', { name: '' }), /ссылк/i);
});

test('validates visible text length while retaining plain messages and adjacent links', () => {
  const longUrl = `https://example.com/${'a'.repeat(5000)}`;
  assert.equal(renderLinkedMessage('[Бот]({url})', { url: longUrl }).text, 'Бот');
  assert.throws(() =>
    renderLinkedMessage('[{name}](https://example.com)', { name: 'a'.repeat(4097) }),
  );
  assert.deepEqual(renderLinkedMessage('Обычный текст <b>без HTML</b>', {}), {
    text: 'Обычный текст <b>без HTML</b>',
    entities: [],
  });
  const adjacent = renderLinkedMessage('[A](https://a.example)[B](https://b.example)', {});
  assert.equal(adjacent.text, 'AB');
  assert.deepEqual(
    adjacent.entities.map(({ offset, length }) => ({ offset, length })),
    [
      { offset: 0, length: 1 },
      { offset: 1, length: 1 },
    ],
  );
});
