import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BroadcastMessagePreview } from '../src/components/BroadcastMessagePreview.tsx';

test('preview displays linked text and escapes HTML supplied by recipient variables', () => {
  const markup = renderToStaticMarkup(
    createElement(BroadcastMessagePreview, {
      text: '<img src=x> 😀 Бот',
      entities: [
        {
          type: 'text_link',
          offset: '<img src=x> 😀 '.length,
          length: 3,
          url: 'https://t.me/test_bot?start=abc',
        },
      ],
    }),
  );
  assert.match(markup, /&lt;img src=x&gt;/);
  assert.match(markup, /<a[^>]+href="https:\/\/t\.me\/test_bot\?start=abc"[^>]*>Бот<\/a>/);
  assert.doesNotMatch(markup, /<img/);
});

test('nested editor formats render once while retaining a clickable link', () => {
  const markup = renderToStaticMarkup(
    createElement(BroadcastMessagePreview, {
      text: 'Привет, Бот!',
      entities: [
        { type: 'bold', offset: 8, length: 3 },
        { type: 'italic', offset: 8, length: 3 },
        { type: 'text_link', offset: 8, length: 3, url: 'https://t.me/test_bot' },
        { type: 'blockquote', offset: 0, length: 12 },
      ],
    }),
  );
  assert.equal((markup.match(/Бот/g) ?? []).length, 1);
  assert.match(markup, /<blockquote>/);
  assert.match(markup, /<strong>/);
  assert.match(markup, /<em>/);
  assert.match(markup, /href="https:\/\/t\.me\/test_bot"/);
});
