'use client';

import { useField, useFormFields } from '@payloadcms/ui';
import type { RelationshipFieldClientComponent } from 'payload';
import { useEffect, useMemo, useState } from 'react';
import { updateRecipientSelection, type RecipientRow } from '../editor/recipientSelection';
import './AdminTables.scss';

type RelationshipValue = number | { id: number };

/** Normalizes populated relationship values for checkbox state and authenticated queries. */
function selectedIds(value: RelationshipValue[] | undefined | null): number[] {
  return (Array.isArray(value) ? value : []).map((item) =>
    typeof item === 'number' ? item : item.id,
  );
}

/** Replaces relationship dropdowns with paged checkboxes and explicit filter-based selection. */
export const RecipientTable: RelationshipFieldClientComponent = ({ path, field, readOnly }) => {
  const { value, setValue, disabled: fieldDisabled } = useField<RelationshipValue[]>({ path });
  const collection = field.relationTo === 'orders' ? 'orders' : 'members';
  const payment = useFormFields(([fields]) => fields.payment?.value) || 'all';
  const products = useFormFields(([fields]) => fields.products?.value) as
    RelationshipValue[] | undefined;
  const status = useFormFields(([fields]) => fields.status?.value);
  const disabled = Boolean(readOnly || fieldDisabled || (status && status !== 'draft'));
  const ids = useMemo(() => selectedIds(value), [value]);
  const productsKey = JSON.stringify(selectedIds(products));
  const [search, setSearch] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    rows: RecipientRow[];
    total: number;
    page: number;
    totalPages: number;
  }>({ rows: [], total: 0, page: 1, totalPages: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectionKey = onlySelected ? JSON.stringify(ids) : '[]';

  /** Creates the same query for a visible page and for selection across all matching pages. */
  function queryBody(allIds = false) {
    return {
      collection,
      payment,
      products: JSON.parse(productsKey),
      search,
      page,
      selectedOnly: onlySelected,
      selectedIds: onlySelected ? ids : [],
      allIds,
    };
  }

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(async () => {
      setBusy(true);
      setError('');
      try {
        const response = await fetch('/api/broadcasts/recipients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection,
            payment,
            products: JSON.parse(productsKey),
            search,
            page,
            selectedOnly: onlySelected,
            selectedIds: JSON.parse(selectionKey),
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.errors?.[0]?.message || 'Не удалось загрузить получателей.');
        if (!controller.signal.aborted) setData(result);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Ошибка загрузки.');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [collection, payment, productsKey, search, page, onlySelected, selectionKey]);

  /** Changes all checkboxes matching the filter, preserving selections outside that filter. */
  async function selectByFilter(selected: boolean) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/broadcasts/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryBody(true)),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.errors?.[0]?.message || 'Не удалось выбрать получателей.');
      setValue(updateRecipientSelection(ids, result.ids, selected));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Ошибка выбора.');
    } finally {
      setBusy(false);
    }
  }

  const pageIds = data.rows.map((row) => row.id);
  const pageSelected = Boolean(pageIds.length && pageIds.every((id) => ids.includes(id)));
  return (
    <section className="admin-table-picker field-type">
      <h3>{typeof field.label === 'string' ? field.label : 'Получатели'}</h3>
      <div className="admin-table-picker__controls">
        <input
          aria-label={`Поиск: ${collection === 'orders' ? 'заказы' : 'участники'}`}
          placeholder="Имя, email, телефон или Telegram"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(event) => {
              setOnlySelected(event.target.checked);
              setPage(1);
            }}
          />
          Только выбранные
        </label>
      </div>
      <div className="admin-table-picker__controls">
        <button type="button" disabled={disabled || busy} onClick={() => void selectByFilter(true)}>
          Выбрать всех по фильтру
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void selectByFilter(false)}
        >
          Снять выбор по фильтру
        </button>
        <button
          type="button"
          disabled={disabled || busy || !ids.length}
          onClick={() => setValue([])}
        >
          Очистить выбор
        </button>
        <span>
          Выбрано: {ids.length}. По фильтру: {data.total}.
        </span>
      </div>
      <p className="field-description">
        Применяются фильтры оплаты и тарифов выше. Кнопки выбора действуют на все страницы
        результата.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="admin-table-picker__scroll" aria-busy={busy}>
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Выбрать всю страницу"
                  checked={pageSelected}
                  disabled={disabled || busy || !pageIds.length}
                  ref={(element) => {
                    if (element)
                      element.indeterminate =
                        !pageSelected && pageIds.some((id) => ids.includes(id));
                  }}
                  onChange={(event) =>
                    setValue(updateRecipientSelection(ids, pageIds, event.target.checked))
                  }
                />
              </th>
              <th>Имя</th>
              <th>Контакты</th>
              <th>Тарифы</th>
              <th>Оплата</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Выбрать: ${row.name}`}
                    checked={ids.includes(row.id)}
                    disabled={disabled || busy}
                    onChange={(event) =>
                      setValue(updateRecipientSelection(ids, [row.id], event.target.checked))
                    }
                  />
                </td>
                <td>{row.name}</td>
                <td>{row.contact || '—'}</td>
                <td>{row.products || '—'}</td>
                <td>{row.payment}</td>
              </tr>
            ))}
            {!data.rows.length && (
              <tr>
                <td colSpan={5}>{busy ? 'Загрузка…' : 'Нет получателей по этому фильтру.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-table-picker__controls">
        <button
          type="button"
          disabled={busy || data.page <= 1}
          onClick={() => setPage(data.page - 1)}
        >
          Назад
        </button>
        <span>
          Страница {data.page} из {data.totalPages}
        </span>
        <button
          type="button"
          disabled={busy || data.page >= data.totalPages}
          onClick={() => setPage(data.page + 1)}
        >
          Далее
        </button>
      </div>
    </section>
  );
};
