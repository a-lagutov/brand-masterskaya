import type { TelegramMessageEntity } from './messaging';

/** Escapes both visible text and quoted Telegram HTML attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Wraps already escaped content in Telegram's supported HTML entities. */
function entityHtml(entity: TelegramMessageEntity, content: string): string {
  switch (entity.type) {
    case 'text_link':
      return `<a href="${escapeHtml(entity.url)}">${content}</a>`;
    case 'bold':
      return `<b>${content}</b>`;
    case 'italic':
      return `<i>${content}</i>`;
    case 'underline':
      return `<u>${content}</u>`;
    case 'strikethrough':
      return `<s>${content}</s>`;
    case 'spoiler':
      return `<tg-spoiler>${content}</tg-spoiler>`;
    case 'code':
      return `<code>${content}</code>`;
    case 'blockquote':
      return `<blockquote>${content}</blockquote>`;
    case 'date_time':
      return `<tg-time unix="${entity.unix_time}" format="${entity.date_time_format}">${content}</tg-time>`;
  }
}

/** Serializes nested entities without interpreting any HTML supplied by message variables. */
export function messageAsTelegramHtml(text: string, entities: TelegramMessageEntity[]): string {
  const ordered = [...entities].sort(
    (first, second) =>
      first.offset - second.offset ||
      second.length - first.length ||
      (first.type === 'blockquote' ? -1 : second.type === 'blockquote' ? 1 : 0),
  );
  /** Emits each visible UTF-16 range once and recurses only into contained entities. */
  function rangeHtml(start: number, end: number, ranges: TelegramMessageEntity[]): string {
    let result = '';
    let cursor = start;
    ranges.forEach((entity, index) => {
      if (entity.offset < cursor || entity.offset + entity.length > end) return;
      result += escapeHtml(text.slice(cursor, entity.offset));
      const nested = ranges
        .slice(index + 1)
        .filter(
          (child) =>
            child.offset >= entity.offset &&
            child.offset + child.length <= entity.offset + entity.length,
        );
      result += entityHtml(entity, rangeHtml(entity.offset, entity.offset + entity.length, nested));
      cursor = entity.offset + entity.length;
    });
    return result + escapeHtml(text.slice(cursor, end));
  }
  return rangeHtml(0, text.length, ordered);
}
