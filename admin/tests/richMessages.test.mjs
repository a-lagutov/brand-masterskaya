import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLinkedMessage } from '../src/bot/messaging.ts';

/** Builds a serialized text node matching Lexical's persistent format. */
function textNode(text, format = 0, style = '') {
  return { type: 'text', version: 1, text, format, style, detail: 0, mode: 'normal' };
}
/** Stores one editor block in the existing message field. */
function richMessage(children, blockType = 'paragraph') {
  return JSON.stringify({
    type: 'telegram-rich-text',
    version: 1,
    editorState: {
      root: { type: 'root', version: 1, children: [{ type: blockType, version: 1, children }] },
    },
  });
}

test('toolbar formatting reaches Telegram with substituted names and UTF-16 offsets', () => {
  const rendered = renderLinkedMessage(
    richMessage([
      textNode('😀 '),
      textNode('{name}', 3),
      textNode(' скрыто', 0, '--telegram-spoiler: 1;'),
    ]),
    { name: '<Анна>' },
  );
  assert.equal(rendered.text, '😀 <Анна> скрыто');
  assert.ok(
    rendered.entities.some(
      (entity) => entity.type === 'bold' && entity.offset === 3 && entity.length === 6,
    ),
  );
  assert.ok(
    rendered.entities.some(
      (entity) => entity.type === 'italic' && entity.offset === 3 && entity.length === 6,
    ),
  );
  assert.ok(rendered.entities.some((entity) => entity.type === 'spoiler'));
});

test('editor links substitute personal URLs and quotes contain formatted text', () => {
  const link = { type: 'link', version: 1, url: '{bot_link}', children: [textNode('Бот', 8)] };
  const rendered = renderLinkedMessage(richMessage([link], 'quote'), {
    bot_link: 'https://t.me/test_bot?start=abc',
  });
  assert.equal(rendered.text, 'Бот');
  assert.ok(
    rendered.entities.some(
      (entity) => entity.type === 'text_link' && entity.url.endsWith('start=abc'),
    ),
  );
  assert.ok(rendered.entities.some((entity) => entity.type === 'underline'));
  assert.ok(rendered.entities.some((entity) => entity.type === 'blockquote'));
});

test('all inline toolbar formats and date-time entities are preserved', () => {
  const rendered = renderLinkedMessage(
    richMessage([
      textNode('strike', 4),
      textNode('code', 16),
      textNode('дата', 0, '--telegram-unix-time: 1794000000;'),
    ]),
    {},
  );
  assert.deepEqual(
    rendered.entities.map((entity) => entity.type),
    ['strikethrough', 'code', 'date_time'],
  );
  assert.equal(rendered.entities[2].unix_time, 1794000000);
});

test('rich messages reject unsafe links, invalid dates and malformed editor state', () => {
  assert.throws(
    () =>
      renderLinkedMessage(
        richMessage([
          { type: 'link', version: 1, url: 'javascript:alert(1)', children: [textNode('Бот')] },
        ]),
        {},
      ),
    /ссылк/i,
  );
  assert.throws(
    () =>
      renderLinkedMessage(richMessage([textNode('дата', 0, '--telegram-unix-time: nope;')]), {}),
    /дат/i,
  );
  assert.throws(
    () =>
      renderLinkedMessage(
        JSON.stringify({ type: 'telegram-rich-text', version: 1, editorState: {} }),
        {},
      ),
    /редактор/i,
  );
});

test('existing messages open and save in the rich editor without losing links or line breaks', async () => {
  const { initialMessageEditorState, serializeMessageDocument } =
    await import('../src/editor/messageDocument.ts');
  const { createEditor } = await import('lexical');
  const { QuoteNode } = await import('@lexical/rich-text');
  const { LinkNode } = await import('@lexical/link');
  const source = 'Привет, {name}!\n[Бот]({bot_link})\n😀 До встречи';
  const state = initialMessageEditorState(source);
  const editor = createEditor({
    namespace: 'test-rich-message',
    nodes: [QuoteNode, LinkNode],
    onError(error) {
      throw error;
    },
  });
  editor.setEditorState(editor.parseEditorState(JSON.stringify(state)));
  const persisted = serializeMessageDocument(editor.getEditorState().toJSON());
  const variables = { name: '<Анна>', bot_link: 'https://t.me/test_bot?start=abc' };
  assert.deepEqual(
    renderLinkedMessage(persisted, variables),
    renderLinkedMessage(source, variables),
  );
});
