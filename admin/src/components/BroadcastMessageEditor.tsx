'use client';

import { useField, useFormFields } from '@payloadcms/ui';
import { LinkNode, $toggleLink, $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { QuoteNode, $createQuoteNode } from '@lexical/rich-text';
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
  $setBlocksType,
} from '@lexical/selection';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  FORMAT_TEXT_COMMAND,
  IS_CODE,
  type BaseSelection,
  type EditorState,
  type RangeSelection,
  type TextFormatType,
} from 'lexical';
import type { TextareaFieldClientComponent } from 'payload';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';

import {
  initialMessageEditorState,
  MESSAGE_VARIABLES,
  serializeMessageDocument,
} from '../editor/messageDocument';
import './BroadcastMessageEditor.scss';

type MessageVariableOption = { value: string; label: string };
type MessageEditorProps = ComponentProps<TextareaFieldClientComponent> & {
  variables: readonly MessageVariableOption[];
};

const INLINE_FORMATS: { value: TextFormatType; title: string; label: string }[] = [
  { value: 'bold', title: 'Жирный', label: 'B' },
  { value: 'italic', title: 'Курсив', label: 'I' },
  { value: 'underline', title: 'Подчёркнутый', label: 'U' },
  { value: 'strikethrough', title: 'Зачёркнутый', label: 'S' },
  { value: 'code', title: 'Моноширинный', label: 'M' },
];

/** Draws compact Telegram-style toolbar icons without loading external icon resources. */
function ToolbarIcon({ name }: { name: 'quote' | 'spoiler' | 'date' | 'link' | 'clear' }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'quote' && (
        <>
          <path d="M5 5v14h15M9 8h10M9 12h7" />
          <path d="M14 3h3v3h-3M19 3h3v3h-3" />
        </>
      )}
      {name === 'spoiler' && (
        <>
          {[5, 10, 15, 20].flatMap((horizontal) =>
            [4, 9, 14, 19].map((vertical) => (
              <circle
                key={`${horizontal}-${vertical}`}
                cx={horizontal}
                cy={vertical}
                r="0.7"
                fill="currentColor"
                stroke="none"
              />
            )),
          )}
        </>
      )}
      {name === 'date' && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="4" />
          <path d="M7 2v6M17 2v6M3 11h18" />
        </>
      )}
      {name === 'link' && (
        <>
          <path
            d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 7l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"
            transform="translate(0 -1) scale(.95)"
          />
        </>
      )}
      {name === 'clear' && (
        <>
          <path d="m7 5 8 0M11 5 7 19M4 19h7M16 9l6 6-5 5h-6l-3-3zM15 18l4-4" />
          <path d="M3 3 21 21" />
        </>
      )}
    </svg>
  );
}

/** Allows documented placeholders in link targets while rejecting executable URL schemes. */
function validEditorLink(value: string): boolean {
  if (/^\{(?:bot_link|site)\}$/.test(value)) return true;
  try {
    return (
      ['http:', 'https:', 'tg:', 'mailto:'].includes(new URL(value).protocol) && !/\s/.test(value)
    );
  } catch {
    return false;
  }
}

/** Keeps toolbar state and selection inside Lexical so menus never lose the insertion position. */
function MessageToolbar({
  disabled,
  variables,
}: {
  disabled: boolean;
  variables: readonly MessageVariableOption[];
}) {
  const [editor] = useLexicalComposerContext();
  const savedSelection = useRef<BaseSelection | null>(null);
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'link' | 'date' | null>(null);
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [dateValue, setDateValue] = useState('');
  const [dialogError, setDialogError] = useState('');

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          savedSelection.current = selection.clone();
          const formats = INLINE_FORMATS.filter(({ value }) => selection.hasFormat(value)).map(
            ({ value }) => String(value),
          );
          if (selection.anchor.getNode().getTopLevelElement()?.getType() === 'quote')
            formats.push('quote');
          if ($getSelectionStyleValueForProperty(selection, '--telegram-spoiler') === '1')
            formats.push('spoiler');
          setActiveFormats(formats);
        });
      }),
    [editor],
  );

  /** Applies an edit at the last text selection, then returns focus to the message. */
  function editSelection(action: (selection: RangeSelection) => void) {
    editor.update(() => {
      if (savedSelection.current) $setSelection(savedSelection.current.clone());
      let selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd();
        selection = $getSelection();
      }
      if ($isRangeSelection(selection)) action(selection);
    });
    editor.focus();
  }

  /** Keeps monospace exclusive with other inline marks, matching Telegram's entity rules. */
  function formatText(format: TextFormatType) {
    editSelection((selection) => {
      if (format === 'code' && !selection.hasFormat('code')) {
        for (const node of selection.extract())
          if ($isTextNode(node)) node.setFormat(0).setStyle('');
        selection.setFormat(0);
        selection.setStyle('');
        $toggleLink(null);
      } else if (format !== 'code' && selection.hasFormat('code')) {
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code');
      }
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    });
  }

  /** Opens a focused dialog while preserving the selected words and any existing link. */
  function openDialog(kind: 'link' | 'date') {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        savedSelection.current = selection.clone();
        const parent = selection.anchor.getNode().getParent();
        if ($isLinkNode(parent) && selection.isCollapsed()) {
          const firstText = parent.getFirstDescendant();
          const lastText = parent.getLastDescendant();
          if ($isTextNode(firstText) && $isTextNode(lastText)) {
            const entireLink = selection.clone();
            entireLink.anchor.set(firstText.getKey(), 0, 'text');
            entireLink.focus.set(lastText.getKey(), lastText.getTextContentSize(), 'text');
            savedSelection.current = entireLink;
          }
          setLinkLabel(parent.getTextContent());
        } else setLinkLabel(selection.getTextContent());
        setLinkUrl($isLinkNode(parent) ? parent.getURL() : '');
      }
    });
    setDialogError('');
    setDialog(kind);
  }

  /** Inserts a link or a date atom using the captured selection; no Markdown is required. */
  function insertDialogContent() {
    if (dialog === 'link') {
      if (!linkLabel.trim() || !validEditorLink(linkUrl)) {
        setDialogError('Введите текст и корректный адрес ссылки.');
        return;
      }
      editSelection((selection) => {
        // Code cannot be combined with a link in Telegram.
        for (const node of selection.extract())
          if ($isTextNode(node)) node.setFormat(node.getFormat() & ~IS_CODE);
        selection.setFormat(selection.format & ~IS_CODE);
        if (selection.getTextContent() !== linkLabel || selection.isCollapsed()) {
          const label = $createTextNode(linkLabel)
            .setFormat(selection.format & ~IS_CODE)
            .setStyle(selection.style);
          selection.insertNodes([label]);
          label.select(0, label.getTextContentSize());
        }
        $toggleLink(linkUrl);
        const linkedSelection = $getSelection();
        if ($isRangeSelection(linkedSelection))
          linkedSelection.anchor.set(
            linkedSelection.focus.key,
            linkedSelection.focus.offset,
            linkedSelection.focus.type,
          );
      });
    } else {
      const timestamp = Math.floor(new Date(`${dateValue}+03:00`).getTime() / 1000);
      if (!Number.isInteger(timestamp) || timestamp < 1 || timestamp > 2_147_483_647) {
        setDialogError('Выберите дату и время до 2038 года.');
        return;
      }
      const label = new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Europe/Moscow',
      }).format(new Date(timestamp * 1000));
      editSelection((selection) =>
        selection.insertNodes([
          $createTextNode(label)
            .setMode('token')
            .setStyle(
              `--telegram-unix-time: ${timestamp}; background-color: var(--theme-elevation-150);`,
            ),
          $createTextNode(' '),
        ]),
      );
    }
    setDialog(null);
  }

  /** Removes text marks, links and block quotes only from the selected content. */
  function clearFormatting() {
    editSelection((selection) => {
      for (const node of selection.extract()) if ($isTextNode(node)) node.setFormat(0).setStyle('');
      selection.setFormat(0);
      selection.setStyle('');
      $patchStyleText(selection, {
        '--telegram-spoiler': null,
        '--telegram-unix-time': null,
        'background-color': null,
      });
      // Unwrapping links is handled by the same registered command as the Link plugin.
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      $setBlocksType(selection, $createParagraphNode);
    });
  }

  return (
    <>
      <div
        className="telegram-editor__toolbar"
        role="toolbar"
        aria-label="Форматирование сообщения"
      >
        <select
          className="telegram-editor__variables"
          aria-label="Вставить переменную"
          disabled={disabled}
          value=""
          onChange={(event) => {
            const variable = event.currentTarget.value;
            if (variable)
              editSelection((selection) =>
                selection.insertNodes([
                  $createTextNode(`{${variable}}`)
                    .setMode('token')
                    .setFormat(selection.format)
                    .setStyle(selection.style),
                ]),
              );
          }}
        >
          <option value="" disabled>
            Вставить переменную
          </option>
          {variables.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span className="telegram-editor__divider" />
        <button
          type="button"
          title="Цитата"
          aria-label="Цитата"
          aria-pressed={activeFormats.includes('quote')}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            editSelection((selection) =>
              $setBlocksType(selection, () =>
                activeFormats.includes('quote') ? $createParagraphNode() : $createQuoteNode(),
              ),
            )
          }
        >
          <ToolbarIcon name="quote" />
        </button>
        <button
          type="button"
          title="Скрытый текст"
          aria-label="Скрытый текст"
          aria-pressed={activeFormats.includes('spoiler')}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            editSelection((selection) =>
              $patchStyleText(selection, {
                '--telegram-spoiler': activeFormats.includes('spoiler') ? null : '1',
                'background-color': activeFormats.includes('spoiler')
                  ? null
                  : 'var(--theme-elevation-200)',
              }),
            )
          }
        >
          <ToolbarIcon name="spoiler" />
        </button>
        <span className="telegram-editor__divider" />
        {INLINE_FORMATS.map(({ value, title, label }) => (
          <button
            key={value}
            type="button"
            className={`telegram-editor__format telegram-editor__format--${value}`}
            title={title}
            aria-label={title}
            aria-pressed={activeFormats.includes(value)}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              formatText(value);
            }}
          >
            {label}
          </button>
        ))}
        <span className="telegram-editor__divider" />
        <button
          type="button"
          title="Дата и время"
          aria-label="Дата и время"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openDialog('date')}
        >
          <ToolbarIcon name="date" />
        </button>
        <button
          type="button"
          title="Вставить ссылку"
          aria-label="Вставить ссылку"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openDialog('link')}
        >
          <ToolbarIcon name="link" />
        </button>
        <button
          type="button"
          title="Очистить форматирование"
          aria-label="Очистить форматирование"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearFormatting}
        >
          <ToolbarIcon name="clear" />
        </button>
      </div>
      {dialog && (
        <div
          className="telegram-editor__dialog"
          role="dialog"
          aria-label={dialog === 'link' ? 'Вставить ссылку' : 'Дата и время'}
        >
          {dialog === 'link' ? (
            <>
              <label>
                Текст ссылки
                <input
                  autoFocus
                  value={linkLabel}
                  onChange={(event) => setLinkLabel(event.target.value)}
                />
              </label>
              <label>
                Адрес ссылки
                <input
                  value={linkUrl}
                  placeholder={
                    variables.some((variable) => variable.value === 'bot_link')
                      ? 'https://example.com или {bot_link}'
                      : 'https://example.com или {site}'
                  }
                  onChange={(event) => setLinkUrl(event.target.value)}
                />
              </label>
              <select
                aria-label="Переменная для адреса ссылки"
                value=""
                onChange={(event) => setLinkUrl(`{${event.target.value}}`)}
              >
                <option value="" disabled>
                  Или выбрать ссылку из переменных
                </option>
                {variables
                  .filter((variable) => ['bot_link', 'site'].includes(variable.value))
                  .map((variable) => (
                    <option key={variable.value} value={variable.value}>
                      {variable.label}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <label>
              Дата и время по Москве
              <input
                autoFocus
                type="datetime-local"
                value={dateValue}
                onChange={(event) => setDateValue(event.target.value)}
              />
            </label>
          )}
          {dialogError && <p role="alert">{dialogError}</p>}
          <div>
            <button type="button" onClick={insertDialogContent}>
              Вставить
            </button>
            <button
              type="button"
              onClick={() => {
                setDialog(null);
                editor.focus();
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Syncs external form resets without feeding each keystroke back into Lexical. */
function EditorFormSync({
  value,
  disabled,
  lastValue,
}: {
  value: string;
  disabled: boolean;
  lastValue: React.RefObject<string>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    editor.setEditorState(
      editor.parseEditorState(JSON.stringify(initialMessageEditorState(value))),
    );
  }, [editor, value, lastValue]);
  return null;
}

/** WYSIWYG Telegram-style message field with insertion menus, formatting and ordinary form persistence. */
function MessageEditor({ path, readOnly, field, variables }: MessageEditorProps) {
  const {
    value,
    setValue,
    showError,
    errorMessage,
    disabled: fieldDisabled,
  } = useField<string>({ path });
  const status = useFormFields(([fields]) => fields.status?.value);
  const disabled = Boolean(readOnly || fieldDisabled || (status && status !== 'draft'));
  const lastValue = useRef(value || '');
  const [editorError, setEditorError] = useState('');
  const initialConfig = useMemo(
    () => ({
      namespace: 'TelegramBroadcastMessage',
      nodes: [QuoteNode, LinkNode],
      editable: !disabled,
      editorState: JSON.stringify(initialMessageEditorState(value || '')),
      onError: () => setEditorError('Не удалось изменить текст. Обновите страницу.'),
      theme: {
        paragraph: 'telegram-editor__paragraph',
        quote: 'telegram-editor__quote',
        link: 'telegram-editor__link',
        text: {
          bold: 'telegram-editor__bold',
          italic: 'telegram-editor__italic',
          underline: 'telegram-editor__underline',
          strikethrough: 'telegram-editor__strike',
          underlineStrikethrough: 'telegram-editor__underline-strike',
          code: 'telegram-editor__code',
        },
      },
      // Lexical owns the state after initialization; form resets are handled by EditorFormSync.
    }),
    [],
  );

  /** Saves visible text as structured data; an empty editor remains an empty required field. */
  function saveEditorState(editorState: EditorState) {
    const nextValue = editorState.read(() =>
      $getRoot().getTextContent().trim() ? serializeMessageDocument(editorState.toJSON()) : '',
    );
    lastValue.current = nextValue;
    setValue(nextValue);
  }

  return (
    <div className="field-type telegram-editor">
      <label className="field-label" id={`${path}-label`}>
        {typeof field.label === 'string' ? field.label : 'Текст'}{' '}
        {field.required && <span className="required">*</span>}
      </label>
      <LexicalComposer initialConfig={initialConfig}>
        <MessageToolbar disabled={disabled} variables={variables} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="telegram-editor__input"
              aria-labelledby={`${path}-label`}
              aria-multiline="true"
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <LinkPlugin validateUrl={validEditorLink} />
        <OnChangePlugin ignoreSelectionChange onChange={saveEditorState} />
        <EditorFormSync value={value || ''} disabled={disabled} lastValue={lastValue} />
      </LexicalComposer>
      <p className="field-description">
        Выделите текст и выберите формат. Переменная вставляется на место курсора.
      </p>
      {(showError || editorError) && <p role="alert">{editorError || errorMessage}</p>}
    </div>
  );
}

/** Broadcast editor exposes contact, order and personal bot-link variables. */
export const BroadcastMessageEditor: TextareaFieldClientComponent = (props) => (
  <MessageEditor {...props} variables={MESSAGE_VARIABLES} />
);

/** Automatic bot replies expose only variables available in their runtime context. */
export const BotTextEditor: TextareaFieldClientComponent = (props) => {
  const variables = [
    { value: 'name', label: 'Имя пользователя' },
    { value: 'site', label: 'Адрес сайта' },
    { value: 'contact', label: 'Контакты организаторов' },
  ];
  if (props.field.name === 'paid')
    variables.push(
      { value: 'items', label: 'Позиции заказа' },
      { value: 'total', label: 'Сумма заказа' },
    );
  return <MessageEditor {...props} variables={variables} />;
};
