import type { Member, Order } from '../payload-types';
import { IS_BOLD, IS_ITALIC, IS_UNDERLINE, IS_STRIKETHROUGH, IS_CODE } from 'lexical';
import {
  MessageValidationError,
  parseTemplateParts,
  readMessageDocument,
  type MessageEditorNode,
} from '../editor/messageDocument';
export { MessageValidationError } from '../editor/messageDocument';

/** Filters saved with a broadcast; all selected conditions intersect. */
export type AudienceFilter = {
  audience: 'all' | 'selected';
  members?: (number | Member)[] | null;
  products?: (number | { id: number })[] | null;
  payment: 'all' | 'paid' | 'unpaid';
};

/** Resolves either a populated relationship or its numeric identifier. */
function relationshipId(value: number | { id: number }): number {
  return typeof value === 'number' ? value : value.id;
}

/** Builds an ordinary bot link or an existing order's purchase claim link. */
export function botStartLink(username: string, orderId?: string | null): string {
  const normalized = username.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(normalized))
    throw new MessageValidationError('Не задано имя Telegram-бота.');
  if (orderId && !/^[a-f0-9]{32}$/.test(orderId))
    throw new MessageValidationError('Некорректный номер заказа.');
  return `https://t.me/${normalized}${orderId ? `?start=${orderId}` : ''}`;
}

/** Telegram text-link offsets and lengths use UTF-16 code units. */
export type TextLinkEntity = { type: 'text_link'; offset: number; length: number; url: string };

/** Entity subset supported by the Telegram-style message editor. */
export type TelegramMessageEntity =
  | TextLinkEntity
  | {
      type: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'blockquote';
      offset: number;
      length: number;
    }
  | {
      type: 'date_time';
      offset: number;
      length: number;
      unix_time: number;
      date_time_format: 'dt';
    };

/** Substitutes variables once so user data cannot create more placeholders or formatting. */
function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name: string) => {
    if (!Object.hasOwn(variables, name))
      throw new MessageValidationError(`Неизвестная переменная: ${name}`);
    return variables[name];
  });
}

/** Checks the final visible text, excluding hidden link destinations. */
function validateMessageText(text: string): void {
  if (!text.trim() || [...text].length > 4096) {
    throw new MessageValidationError(
      'Сообщение должно содержать от 1 до 4096 символов после подстановки.',
    );
  }
}

/** Replaces documented placeholders once and validates Telegram's plain-text limit. */
export function renderMessage(template: string, variables: Record<string, string>): string {
  const text = substituteVariables(template, variables);
  validateMessageText(text);
  return text;
}

/** Validates link protocols before a URL reaches Telegram or the admin's browser. */
function validateLinkUrl(value: string): string {
  try {
    const url = new URL(value);
    if (/\s/.test(value) || !['https:', 'http:', 'tg:', 'mailto:'].includes(url.protocol)) {
      throw new Error('Unsupported link target');
    }
    return url.href;
  } catch {
    throw new MessageValidationError(
      'Проверьте адрес ссылки. Пример: [Текст](https://example.com).',
    );
  }
}

/** Converts the supported editor tree into visible Telegram text and explicit entities. */
function renderRichMessage(root: MessageEditorNode, variables: Record<string, string>) {
  let text = '';
  const entities: TelegramMessageEntity[] = [];
  let nodeCount = 0;

  /** Visits supported nodes only; untrusted JSON cannot inject HTML or Telegram operations. */
  function visit(node: MessageEditorNode, depth: number): void {
    if (depth > 32 || ++nodeCount > 10_000)
      throw new MessageValidationError('Сообщение слишком сложное для редактора.');
    if (!node || typeof node.type !== 'string')
      throw new MessageValidationError('Некорректные данные редактора сообщения.');
    const offset = text.length;
    if (node.type === 'text' || node.type === 'tab') {
      if (typeof node.text !== 'string')
        throw new MessageValidationError('Некорректный текст редактора.');
      const content = substituteVariables(node.text, variables);
      text += content;
      if (!content.length) return;
      const format = typeof node.format === 'number' ? node.format : 0;
      const span = { offset, length: content.length };
      if (format & IS_CODE) {
        entities.push({ type: 'code', ...span });
        return;
      }
      const formats = [
        ['bold', IS_BOLD],
        ['italic', IS_ITALIC],
        ['underline', IS_UNDERLINE],
        ['strikethrough', IS_STRIKETHROUGH],
      ] as const;
      for (const [type, flag] of formats) if (format & flag) entities.push({ type, ...span });
      if (/--telegram-spoiler:\s*1(?:;|$)/.test(node.style ?? ''))
        entities.push({ type: 'spoiler', ...span });
      if ((node.style ?? '').includes('--telegram-unix-time:')) {
        const timestamp = Number(node.style?.match(/--telegram-unix-time:\s*(\d+)(?:;|$)/)?.[1]);
        if (!Number.isInteger(timestamp) || timestamp < 1 || timestamp > 2_147_483_647)
          throw new MessageValidationError('Некорректная дата в сообщении.');
        entities.push({ type: 'date_time', ...span, unix_time: timestamp, date_time_format: 'dt' });
      }
      return;
    }
    if (node.type === 'linebreak') {
      text += '\n';
      return;
    }
    if (
      !['root', 'paragraph', 'quote', 'link'].includes(node.type) ||
      !Array.isArray(node.children)
    )
      throw new MessageValidationError('Неподдерживаемый блок редактора сообщения.');
    node.children.forEach((child, index) => {
      if (node.type === 'root' && index) text += '\n';
      visit(child, depth + 1);
    });
    const length = text.length - offset;
    if (node.type === 'link') {
      const url = validateLinkUrl(substituteVariables(node.url ?? '', variables));
      if (!length) throw new MessageValidationError('Текст ссылки не должен быть пустым.');
      if (
        entities.some(
          (entity) =>
            entity.type === 'code' && entity.offset >= offset && entity.offset < text.length,
        )
      )
        throw new MessageValidationError('Уберите моноширинный формат с текста ссылки.');
      entities.push({ type: 'text_link', offset, length, url });
    }
    if (node.type === 'quote' && length) entities.push({ type: 'blockquote', offset, length });
  }

  visit(root, 0);
  validateMessageText(text);
  return { text, entities };
}

/** Renders rich editor data and keeps existing [label](URL) message templates compatible. */
export function renderLinkedMessage(
  template: string,
  variables: Record<string, string>,
): { text: string; entities: TelegramMessageEntity[] } {
  const rich = readMessageDocument(template);
  if (rich) return renderRichMessage(rich.editorState.root, variables);
  const entities: TelegramMessageEntity[] = [];
  let text = '';
  for (const part of parseTemplateParts(template)) {
    const content = substituteVariables(part.text, variables);
    if (part.url !== undefined) {
      if (!content.trim()) throw new MessageValidationError('Текст ссылки не должен быть пустым.');
      entities.push({
        type: 'text_link',
        offset: text.length,
        length: content.length,
        url: validateLinkUrl(substituteVariables(part.url, variables)),
      });
    }
    text += content;
  }
  validateMessageText(text);
  return { text, entities };
}

/** Selects one recipient per Telegram account and the latest matching order. */
export function selectRecipients(members: Member[], orders: Order[], filter: AudienceFilter) {
  const selectedMembers = new Set((filter.members ?? []).map(relationshipId));
  const selectedProducts = new Set((filter.products ?? []).map(relationshipId));
  return members.flatMap((member) => {
    if (filter.audience === 'selected' && !selectedMembers.has(member.id)) return [];
    const matchingOrders = orders.filter((order) => {
      if (order.deletedAt || !order.member || relationshipId(order.member) !== member.id)
        return false;
      if (filter.payment === 'paid' && !order.paidAt) return false;
      if (filter.payment === 'unpaid' && order.paidAt) return false;
      return (
        !selectedProducts.size ||
        (order.products ?? []).some((product) => selectedProducts.has(relationshipId(product)))
      );
    });
    if ((filter.payment !== 'all' || selectedProducts.size) && !matchingOrders.length) return [];
    return [{ member, order: matchingOrders[0] }];
  });
}
