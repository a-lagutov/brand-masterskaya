'use client';

import { useField, useFormFields } from '@payloadcms/ui';
import type { DateFieldClientComponent, DefaultCellComponentProps } from 'payload';

/** Edits schedule instants explicitly in Moscow time, independent of the administrator's timezone. */
export const BroadcastScheduleDate: DateFieldClientComponent = ({ path, field, readOnly }) => {
  const { value, setValue, disabled, showError, errorMessage } = useField<string | null>({ path });
  const status = useFormFields(([fields]) => fields.status?.value);
  const timestamp = Date.parse(value || '');
  const displayed = Number.isFinite(timestamp)
    ? new Date(timestamp + 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : '';
  return (
    <div className="field-type date">
      <label className="field-label" htmlFor={`${path}-moscow`}>
        {typeof field.label === 'string' ? field.label : 'Дата и время (Москва)'}
      </label>
      <input
        id={`${path}-moscow`}
        type="datetime-local"
        value={displayed}
        disabled={Boolean(readOnly || disabled || (status && status !== 'draft'))}
        onChange={(event) => {
          const local = event.target.value;
          setValue(local ? new Date(`${local}:00+03:00`).toISOString() : null);
        }}
      />
      <p className="field-description">Московское время (UTC+3).</p>
      {typeof field.admin?.description === 'string' && (
        <p className="field-description">{field.admin.description}</p>
      )}
      {showError && <p role="alert">{errorMessage}</p>}
    </div>
  );
};

/** Formats schedule cells in Moscow time instead of the browser's local timezone. */
export function BroadcastScheduleDateCell({ cellData }: DefaultCellComponentProps) {
  const timestamp = typeof cellData === 'string' ? Date.parse(cellData) : Number.NaN;
  if (!Number.isFinite(timestamp)) return <span>—</span>;
  return (
    <time dateTime={cellData}>
      {new Date(timestamp).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
    </time>
  );
}
