import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';

/** Placeholders shared by the variable menu and delivery renderer. */
export const MESSAGE_VARIABLES = [
  { value: 'name', label: 'Имя из заказа / Telegram' },
  { value: 'first_name', label: 'Только имя' },
  { value: 'username', label: 'Telegram username' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Телефон' },
  { value: 'bot_link', label: 'Персональная ссылка на бота' },
  { value: 'order_id', label: 'Номер заказа' },
  { value: 'site', label: 'Адрес сайта' },
] as const;

/** User-visible validation errors never contain private Telegram request data. */
export class MessageValidationError extends Error {}

/** The subset of Lexical nodes accepted by Telegram's text formatter. */
export type MessageEditorNode = SerializedLexicalNode & {
  children?: MessageEditorNode[];
  text?: string;
  format?: number | string;
  style?: string;
  url?: string;
};

export type MessageEditorState = SerializedEditorState<MessageEditorNode>;
type MessageDocument = { type: 'telegram-rich-text'; version: 1; editorState: MessageEditorState };
export type TemplatePart = { text: string; url?: string };

/** Reads rich editor data while keeping existing plain-text templates compatible. */
export function readMessageDocument(value: string): MessageDocument | null {
  let candidate: MessageDocument;
  try {
    candidate = JSON.parse(value) as MessageDocument;
  } catch {
    return null;
  }
  if (!candidate || candidate.type !== 'telegram-rich-text') return null;
  if (
    candidate.version !== 1 ||
    candidate.editorState?.root?.type !== 'root' ||
    !Array.isArray(candidate.editorState.root.children)
  ) {
    throw new MessageValidationError('Некорректные данные редактора сообщения.');
  }
  return candidate;
}

/** Serializes rich text into the existing message field without changing the database schema. */
export function serializeMessageDocument(editorState: MessageEditorState): string {
  return JSON.stringify({
    type: 'telegram-rich-text',
    version: 1,
    editorState,
  } satisfies MessageDocument);
}

/** Splits legacy authored links before variables are expanded, preserving balanced URL parentheses. */
export function parseTemplateParts(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const linkPattern = /\[([^\]\r\n]+)\]\(/g;
  let cursor = 0;
  for (let match = linkPattern.exec(template); match; match = linkPattern.exec(template)) {
    const urlStart = linkPattern.lastIndex;
    let position = urlStart;
    let parentheses = 1;
    while (position < template.length && parentheses > 0) {
      if (template[position] === '(') parentheses++;
      if (template[position] === ')') parentheses--;
      position++;
    }
    if (parentheses)
      throw new MessageValidationError(
        'Не закрыта ссылка. Используйте [Текст](https://example.com).',
      );
    parts.push(
      { text: template.slice(cursor, match.index) },
      { text: match[1], url: template.slice(urlStart, position - 1) },
    );
    cursor = position;
    linkPattern.lastIndex = position;
  }
  parts.push({ text: template.slice(cursor) });
  return parts;
}

/** Creates a standard serialized text node for importing an existing template. */
function createTextNode(text: string): MessageEditorNode {
  return {
    type: 'text',
    version: 1,
    text,
    format: 0,
    style: '',
    detail: 0,
    mode: 'normal',
  } as MessageEditorNode;
}

/** Opens existing messages as editable rich text without losing their links or placeholders. */
export function initialMessageEditorState(value: string): MessageEditorState {
  const rich = readMessageDocument(value);
  if (rich) return rich.editorState;
  const children: MessageEditorNode[] = [];
  let parts: TemplatePart[];
  try {
    parts = parseTemplateParts(value);
  } catch {
    parts = [{ text: value }];
  }
  let paragraph: MessageEditorNode = {
    type: 'paragraph',
    version: 1,
    children: [],
    direction: null,
    format: '',
    indent: 0,
  } as MessageEditorNode;
  children.push(paragraph);
  for (const part of parts) {
    const lines = part.text.split('\n');
    lines.forEach((line, index) => {
      if (index) {
        paragraph = {
          type: 'paragraph',
          version: 1,
          children: [],
          direction: null,
          format: '',
          indent: 0,
        } as MessageEditorNode;
        children.push(paragraph);
      }
      if (!line) return;
      const textNode = createTextNode(line);
      paragraph.children!.push(
        part.url !== undefined
          ? ({
              type: 'link',
              version: 1,
              children: [textNode],
              url: part.url,
              direction: null,
              format: '',
              indent: 0,
              rel: null,
              target: null,
              title: null,
            } as MessageEditorNode)
          : textNode,
      );
    });
  }
  return {
    root: { type: 'root', version: 1, children, direction: null, format: '', indent: 0 },
  } as MessageEditorState;
}
