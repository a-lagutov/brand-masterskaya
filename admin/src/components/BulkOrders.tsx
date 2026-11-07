'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { BulkOrderRow } from '../bot/bulkOrders';
import './AdminTables.scss';

type ProductOption = { id: number; title: string; key: string };
type Preview = { rows: BulkOrderRow[]; errors: { row: number; message: string }[]; hash: string };

/** Adds manual orders from a pasted spreadsheet or CSV after an explicit, validated preview. */
export function BulkOrders() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [defaults, setDefaults] = useState<number[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [completed, setCompleted] = useState(false);
  const batchId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch('/api/products?limit=1000&depth=0&sort=title', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось загрузить тарифы.');
        const result = await response.json();
        setProducts(result.docs);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setMessage(failure.message);
      });
    return () => controller.abort();
  }, [open]);

  /** Invalidates the preview and retry identifier whenever the import content changes. */
  function invalidatePreview() {
    setPreview(null);
    setCompleted(false);
    setMessage('');
    batchId.current = null;
  }

  /** Downloads only the column template; no customer data leaves the browser. */
  function downloadTemplate() {
    const content = '\uFEFFИмя\tEmail\tТелефон\tTelegram\tТарифы\tСумма\tОплачен\n';
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'orders-template.tsv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /** Previews all normalized rows or imports exactly that preview, with retry-safe IDs. */
  async function runImport(commit: boolean) {
    setBusy(true);
    setMessage('');
    batchId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/orders/${commit ? 'bulk-import' : 'bulk-preview'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          products: defaults,
          batchId: batchId.current,
          hash: preview?.hash,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.errors?.[0]?.message || 'Не удалось выполнить импорт.');
      if (commit) {
        setMessage(result.message);
        setCompleted(true);
        router.refresh();
      } else setPreview(result);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Ошибка импорта.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="admin-bulk-orders" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Добавить заказы списком</summary>
      <p>
        Вставьте таблицу из Excel / Google Sheets с заголовками или выберите CSV / TSV. До 1000
        заказов за один импорт.
      </p>
      <div className="admin-table-picker__controls">
        <button type="button" onClick={downloadTemplate}>
          Скачать шаблон
        </button>
        <label>
          Открыть CSV / TSV{' '}
          <input
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 1_000_000) {
                setMessage('Файл должен быть не больше 1 МБ.');
                return;
              }
              invalidatePreview();
              setSource(await file.text());
              event.target.value = '';
            }}
          />
        </label>
      </div>
      <label>
        Таблица заказов
        <textarea
          rows={8}
          value={source}
          disabled={busy}
          placeholder={'Имя\tEmail\tТелефон\tTelegram\tТарифы\tСумма\tОплачен'}
          onChange={(event) => {
            invalidatePreview();
            setSource(event.target.value);
          }}
        />
      </label>
      <label>
        Тарифы по умолчанию
        <select
          multiple
          value={defaults.map(String)}
          disabled={busy}
          onChange={(event) => {
            invalidatePreview();
            setDefaults(Array.from(event.target.selectedOptions, (option) => Number(option.value)));
          }}
        >
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.title} ({product.key})
            </option>
          ))}
        </select>
      </label>
      <p className="field-description">
        В «Тарифы» укажите ключи или названия через |. Пустая колонка использует выбранные тарифы по
        умолчанию. Пустая сумма считается по ценам тарифов. Пустая дата — не оплачен; формат даты:
        07.11.2026 или ISO, время без часового пояса считается московским.
      </p>
      <div className="admin-table-picker__controls">
        <button
          type="button"
          disabled={busy || !source.trim() || completed}
          onClick={() => void runImport(false)}
        >
          Проверить таблицу
        </button>
        {preview && !completed && (
          <button
            type="button"
            disabled={busy || !preview.rows.length || Boolean(preview.errors.length)}
            onClick={() => void runImport(true)}
          >
            Добавить {preview.rows.length} заказов
          </button>
        )}
        {completed && (
          <button
            type="button"
            onClick={() => {
              invalidatePreview();
              setSource('');
            }}
          >
            Новый импорт
          </button>
        )}
      </div>
      <p role="status">{busy ? 'Обработка…' : message}</p>
      {preview && (
        <>
          <p>
            Готово к добавлению: {preview.rows.length}. Ошибок: {preview.errors.length}. При ошибках
            импорт не выполняется.
          </p>
          {preview.errors.map((error, index) => (
            <p role="alert" key={index}>
              Строка {error.row}: {error.message}
            </p>
          ))}
          <div className="admin-table-picker__scroll">
            <table>
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Email</th>
                  <th>Телефон / Telegram</th>
                  <th>Тарифы</th>
                  <th>Сумма, ₽</th>
                  <th>Оплачен</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={index}>
                    <td>{row.name}</td>
                    <td>{row.email || '—'}</td>
                    <td>{[row.phone, row.telegram].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      {row.products
                        .map((id) => products.find((product) => product.id === id)?.title || id)
                        .join(', ') || '—'}
                    </td>
                    <td>{row.total}</td>
                    <td>
                      {row.paidAt
                        ? new Date(row.paidAt).toLocaleString('ru-RU', {
                            timeZone: 'Europe/Moscow',
                          })
                        : 'Нет'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
