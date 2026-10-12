'use client';

import { useRowLabel } from '@payloadcms/ui';

const RUBLES = new Intl.NumberFormat('ru-RU');

/** A receipt item's row title, "Смотрю и работаю — 219 900 ₽", instead of "Item 01". */
export function OrderItemLabel() {
  const { data, rowNumber } = useRowLabel<{ title?: string; price?: number }>();
  const title = data?.title || `Позиция ${(rowNumber ?? 0) + 1}`;
  return <span>{data?.price != null ? `${title} — ${RUBLES.format(data.price)} ₽` : title}</span>;
}
