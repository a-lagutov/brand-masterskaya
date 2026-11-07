import type { ReactNode } from 'react';
import type { TelegramMessageEntity } from '../bot/messaging';

/** Wraps visible content in safe React elements matching Telegram's supported formatting. */
function formattedPart(entity: TelegramMessageEntity, content: ReactNode, key: string): ReactNode {
  switch (entity.type) {
    case 'text_link':
      return (
        <a key={key} href={entity.url} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      );
    case 'bold':
      return <strong key={key}>{content}</strong>;
    case 'italic':
      return <em key={key}>{content}</em>;
    case 'underline':
      return <u key={key}>{content}</u>;
    case 'strikethrough':
      return <s key={key}>{content}</s>;
    case 'code':
      return <code key={key}>{content}</code>;
    case 'spoiler':
      return (
        <span key={key} tabIndex={0} className="telegram-message-spoiler" title="Скрытый текст">
          {content}
        </span>
      );
    case 'blockquote':
      return <blockquote key={key}>{content}</blockquote>;
    case 'date_time':
      return (
        <time key={key} dateTime={new Date(entity.unix_time * 1000).toISOString()}>
          {content}
        </time>
      );
  }
}

/** Renders nested entities once, using UTF-16 offsets and React's ordinary escaping. */
function previewRange(
  text: string,
  start: number,
  end: number,
  entities: TelegramMessageEntity[],
): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = start;
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index];
    if (entity.offset < cursor || entity.offset + entity.length > end) continue;
    parts.push(text.slice(cursor, entity.offset));
    const inner = entities
      .slice(index + 1)
      .filter(
        (nested) =>
          nested.offset >= entity.offset &&
          nested.offset + nested.length <= entity.offset + entity.length,
      );
    parts.push(
      formattedPart(
        entity,
        previewRange(text, entity.offset, entity.offset + entity.length, inner),
        `${index}-${entity.offset}`,
      ),
    );
    cursor = entity.offset + entity.length;
  }
  parts.push(text.slice(cursor, end));
  return parts;
}

/** Shows exactly the visible message, including nested styles, links and hidden text. */
export function BroadcastMessagePreview({
  text,
  entities = [],
}: {
  text: string;
  entities?: TelegramMessageEntity[];
}) {
  const ordered = [...entities].sort(
    (first, second) =>
      first.offset - second.offset ||
      second.length - first.length ||
      (first.type === 'blockquote' ? -1 : second.type === 'blockquote' ? 1 : 0),
  );
  return (
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {previewRange(text, 0, text.length, ordered)}
    </div>
  );
}
