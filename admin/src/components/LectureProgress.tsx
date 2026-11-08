'use client';

import { useDocumentInfo } from '@payloadcms/ui';
import { useEffect, useState } from 'react';

type Preparation = {
  processingStatus: 'pending' | 'processing' | 'ready' | 'failed';
  processingProgress?: number | null;
  processingError?: string | null;
};

/** Polls saved preparation state without reloading the editor or replacing unsaved fields. */
export function LectureProgress() {
  const { id } = useDocumentInfo();
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    /** Uses the admin-only collection API; authentication and collection access remain enforced. */
    async function refresh() {
      try {
        const response = await fetch(`/api/lectures/${id}?depth=0`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Preparation unavailable');
        const document = (await response.json()) as Preparation;
        if (controller.signal.aborted) return;
        setPreparation(document);
        setUnavailable(false);
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2000);
      }
    }
    setPreparation(null);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);
  if (!id) return <p>Сохраните лекцию, чтобы начать подготовку видео.</p>;
  if (!preparation)
    return <p>{unavailable ? 'Статус временно недоступен.' : 'Проверяем подготовку видео…'}</p>;
  const status = preparation.processingStatus;
  const percent =
    status === 'ready' ? 100 : Math.max(0, Math.min(99, preparation.processingProgress || 0));
  const label =
    status === 'pending'
      ? 'В очереди — ожидание обработчика'
      : status === 'failed'
        ? 'Ошибка подготовки'
        : status === 'ready'
          ? 'Видео готово'
          : percent >= 90
            ? 'Шифрование и упаковка'
            : 'Кодирование видео';
  return (
    <section aria-label="Подготовка видео" style={{ marginBlock: '1.5rem' }}>
      <p role="status">
        {label}
        {status !== 'pending' && status !== 'failed' ? ` — ${percent}%` : ''}
      </p>
      <progress
        aria-label="Подготовка видео"
        max={100}
        value={percent}
        style={{ width: '100%', accentColor: 'var(--theme-success-500)' }}
      />
      {status === 'pending' && (
        <p>Видео обрабатываются по одному. Статус обновляется автоматически.</p>
      )}
      {status === 'failed' && <p role="alert">{preparation.processingError}</p>}
      {unavailable && <p>Не удалось обновить статус. Повторяем запрос.</p>}
    </section>
  );
}
