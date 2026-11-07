'use client';

import { useDocumentInfo, useFormModified, useFormFields } from '@payloadcms/ui';
import { useState } from 'react';
import type { TelegramMessageEntity } from '../bot/messaging';
import { BroadcastMessagePreview } from './BroadcastMessagePreview';

/** Approved preview uses the saved draft and the exact server-side recipient snapshot. */
type Preview = {
  hash: string;
  deliveries: {
    name: string;
    telegramId: string;
    text: string;
    entities?: TelegramMessageEntity[];
  }[];
  skipped: { name: string; reason: string }[];
};

/** Shows personal message previews and requires an explicit second action to queue delivery. */
export function BroadcastActions() {
  const { id } = useDocumentInfo();
  const modified = useFormModified();
  const status = useFormFields(([fields]) => fields.status?.value);
  const scheduleMode = useFormFields(([fields]) => fields.scheduleMode?.value);
  const scheduled = Boolean(scheduleMode && scheduleMode !== 'now');
  const draft = !status || status === 'draft';
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  /** Runs one authenticated action and presents short server errors in the editor. */
  async function runAction(action: 'preview' | 'send' | 'cancel') {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/broadcasts/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'send' ? { hash: preview?.hash } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0]?.message || 'Запрос не выполнен.');
      if (action !== 'preview') {
        setPreview(null);
        setMessage(result.message);
        // Reload the saved document so status, read-only fields and run history stay consistent.
        window.location.reload();
      } else setPreview(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка запроса.');
      if (action !== 'preview') setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginBlock: '1.5rem' }}>
      {draft && <p>Сохраните изменения перед предпросмотром.</p>}
      {draft && scheduled && (
        <p>
          Время запуска — московское. Предпросмотр показывает получателей сейчас. Перед каждым
          запуском получатели и переменные обновляются по сохранённым условиям. После включения
          расписание нельзя редактировать; будущие запуски можно остановить.
        </p>
      )}
      {draft && !scheduled && <p>После запуска текст и получатели фиксируются.</p>}
      {status === 'scheduled' && (
        <>
          <p>
            Расписание включено. Остановка отменяет будущие запуски; уже начатая отправка
            завершится.
          </p>
          <button
            type="button"
            className="btn btn--style-secondary"
            disabled={busy || modified}
            onClick={() => void runAction('cancel')}
          >
            Остановить расписание
          </button>
        </>
      )}
      {draft && (
        <>
          <button
            type="button"
            className="btn btn--style-secondary"
            disabled={!id || modified || busy}
            onClick={() => void runAction('preview')}
          >
            Предпросмотр и получатели
          </button>
          {modified && <p>Сначала сохраните изменения.</p>}
          {preview && !modified && (
            <>
              <p>
                {scheduled ? 'В текущем предпросмотре' : 'Будет отправлено'}:{' '}
                {preview.deliveries.length}. Пропущено: {preview.skipped.length}.
              </p>
              {preview.deliveries.map((delivery) => (
                <details key={delivery.telegramId}>
                  <summary>
                    {delivery.name} · {delivery.telegramId}
                  </summary>
                  <BroadcastMessagePreview text={delivery.text} entities={delivery.entities} />
                </details>
              ))}
              {preview.skipped.map((recipient, index) => (
                <p key={index}>
                  {recipient.name}: {recipient.reason}
                </p>
              ))}
              <button
                type="button"
                className="btn btn--style-primary"
                disabled={busy || (!scheduled && !preview.deliveries.length)}
                onClick={() => void runAction('send')}
              >
                {scheduled
                  ? 'Включить расписание'
                  : `Отправить ${preview.deliveries.length} получателям`}
              </button>
            </>
          )}
        </>
      )}
      <p role="status">{busy ? 'Обработка…' : message}</p>
    </section>
  );
}
