import { createHash } from 'node:crypto';
import { beginTransaction } from '@payloadcms/drizzle';
import { APIError, createLocalReq, type Endpoint, type PayloadRequest } from 'payload';

/** A validated manually entered order, without external identifiers or sync metadata. */
export type BulkOrderRow = {
  name: string;
  email: string | null;
  phone: string;
  telegram: string;
  products: number[];
  total: number;
  paidAt: string | null;
};
type ImportProduct = { id: number; key: string; title: string; price?: number | null };
type BulkPreview = { rows: BulkOrderRow[]; errors: { row: number; message: string }[] };
const IMPORT_LIMIT = 1000;
const importLocks = new Set<string>();
const COLUMN_NAMES: Record<string, keyof BulkOrderRow> = {
  name: 'name',
  имя: 'name',
  email: 'email',
  почта: 'email',
  phone: 'phone',
  телефон: 'phone',
  telegram: 'telegram',
  тг: 'telegram',
  products: 'products',
  тарифы: 'products',
  тариф: 'products',
  сумма: 'total',
  total: 'total',
  paidat: 'paidAt',
  оплачен: 'paidAt',
  'дата оплаты': 'paidAt',
};

/** Parses quoted CSV or tab-separated spreadsheet cells without evaluating their contents. */
function tableCells(source: string): string[][] {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += character;
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new Error('Не закрыты кавычки в CSV.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

/** Parses a calendar date explicitly, interpreting dates without timezone as Moscow time. */
function paymentDate(value: string): string | null {
  if (!value) return null;
  const russian = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{2}):(\d{2}))?$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
  if (!russian && !iso) throw new Error('Дата оплаты: используйте ДД.ММ.ГГГГ или ISO.');
  const year = Number(russian ? russian[3] : iso![1]);
  const month = Number(russian ? russian[2] : iso![2]);
  const day = Number(russian ? russian[1] : iso![3]);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    throw new Error('Некорректная дата оплаты.');
  let normalized = russian
    ? `${russian[3]}-${russian[2].padStart(2, '0')}-${russian[1].padStart(2, '0')}T${russian[4] || '00'}:${russian[5] || '00'}:00+03:00`
    : value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00+03:00';
  else if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) normalized += '+03:00';
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new Error('Некорректная дата оплаты.');
  return new Date(timestamp).toISOString();
}

/** Validates every row before any database write and resolves products by key or title. */
export function parseOrderTable(
  source: string,
  products: ImportProduct[],
  defaults: number[] = [],
): BulkPreview {
  const result: BulkPreview = { rows: [], errors: [] };
  try {
    if (typeof source !== 'string' || source.length > 1_000_000)
      throw new Error('Таблица должна быть не больше 1 МБ.');
    const cells = tableCells(source.replace(/^\uFEFF/, ''));
    if (cells.length < 2 || cells.length > IMPORT_LIMIT + 1)
      throw new Error(`Добавьте заголовки и от 1 до ${IMPORT_LIMIT} строк заказов.`);
    const headers = cells[0].map((header) => COLUMN_NAMES[header.trim().toLowerCase()]);
    if (
      headers.some((header) => !header) ||
      !headers.includes('name') ||
      new Set(headers).size !== headers.length
    )
      throw new Error(
        'Проверьте заголовки: Имя, Email, Телефон, Telegram, Тарифы, Сумма, Оплачен. «Имя» обязательно, заголовки не повторяются.',
      );
    if (defaults.some((id) => !products.some((product) => product.id === id)))
      throw new Error('Один из тарифов по умолчанию не существует.');
    for (const [index, cellsRow] of cells.slice(1).entries()) {
      try {
        if (cellsRow.length > headers.length)
          throw new Error('Количество колонок больше, чем заголовков.');
        const values = Object.fromEntries(
          headers.map((header, column) => [header, (cellsRow[column] ?? '').trim()]),
        ) as Record<keyof BulkOrderRow, string>;
        if (!values.name) throw new Error('Заполните имя.');
        if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
          throw new Error('Некорректный Email.');
        const selectedProducts = values.products
          ? values.products.split('|').map((value) => {
              const product = products.find((candidate) =>
                [candidate.key.toLowerCase(), candidate.title.toLowerCase()].includes(
                  value.trim().toLowerCase(),
                ),
              );
              if (!product) throw new Error(`Не найден тариф: ${value.trim()}.`);
              return product.id;
            })
          : defaults;
        const productIds = [...new Set(selectedProducts)];
        const amount = values.total
          ? Number(values.total.replace(/[\s\u00a0₽]/g, '').replace(',', '.'))
          : productIds.reduce(
              (sum, id) => sum + (products.find((product) => product.id === id)?.price ?? 0),
              0,
            );
        if (
          !Number.isFinite(amount) ||
          amount < 0 ||
          !Number.isSafeInteger(Math.round(amount * 100)) ||
          Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
        )
          throw new Error('Сумма должна быть неотрицательным числом с точностью до копеек.');
        result.rows.push({
          name: values.name,
          email: values.email || null,
          phone: values.phone || '',
          telegram: values.telegram || '',
          products: productIds,
          total: amount,
          paidAt: paymentDate(values.paidAt || ''),
        });
      } catch (error) {
        result.errors.push({
          row: index + 2,
          message: error instanceof Error ? error.message : 'Некорректная строка.',
        });
      }
    }
  } catch (error) {
    result.errors.push({
      row: 1,
      message: error instanceof Error ? error.message : 'Не удалось прочитать таблицу.',
    });
  }
  return result;
}

/** Previews or atomically imports an authenticated administrator's validated batch. */
async function bulkAction(request: PayloadRequest, commit: boolean): Promise<Response> {
  if (!request.user || request.user.collection !== 'users')
    throw new APIError('Нужен вход в админку.', 401);
  const input = (await request.json!()) as {
    source?: unknown;
    products?: unknown;
    batchId?: unknown;
    hash?: unknown;
  };
  if (
    typeof input.source !== 'string' ||
    (input.products !== undefined &&
      (!Array.isArray(input.products) ||
        input.products.some((value) => !Number.isSafeInteger(value) || value <= 0)))
  )
    throw new APIError('Некорректные данные таблицы.', 400);
  const products = (
    await request.payload.find({ collection: 'products', pagination: false, depth: 0 })
  ).docs;
  const preview = parseOrderTable(input.source, products, (input.products ?? []) as number[]);
  const hash = createHash('sha256').update(JSON.stringify(preview.rows)).digest('hex');
  if (!commit) return Response.json({ ...preview, hash });
  if (preview.errors.length || !preview.rows.length || input.hash !== hash)
    throw new APIError('Обновите предпросмотр и исправьте ошибки таблицы.', 400);
  if (typeof input.batchId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.batchId))
    throw new APIError('Некорректный идентификатор импорта.', 400);
  const lockKey = `${request.user.id}:${input.batchId}`;
  if (importLocks.has(lockKey)) throw new APIError('Этот импорт уже выполняется.', 409);
  importLocks.add(lockKey);
  let transactionID: string | number | null = null;
  try {
    // SQLite keeps ordinary requests non-transactional; only the import needs this explicit transaction.
    transactionID = await beginTransaction.call(request.payload.db, { behavior: 'immediate' });
    if (transactionID === null)
      throw new APIError('Не удалось начать импорт. Повторите запрос.', 503);
    const localRequest = await createLocalReq({ user: request.user }, request.payload);
    localRequest.transactionID = transactionID;
    let created = 0;
    let skipped = 0;
    for (const [index, row] of preview.rows.entries()) {
      // A retry of the same batch and row reuses its unique order ID instead of duplicating it.
      const orderId = createHash('sha256')
        .update(JSON.stringify(['manual-import', input.batchId, index, row]))
        .digest('hex')
        .slice(0, 32);
      const existing = await request.payload.find({
        collection: 'orders',
        where: { orderId: { equals: orderId } },
        limit: 1,
        depth: 0,
        trash: true,
        req: localRequest,
      });
      if (existing.totalDocs) {
        skipped++;
        continue;
      }
      await request.payload.create({
        collection: 'orders',
        data: { ...row, orderId },
        req: localRequest,
        overrideAccess: false,
        depth: 0,
      });
      created++;
    }
    await request.payload.db.commitTransaction(transactionID);
    transactionID = null;
    return Response.json({
      created,
      skipped,
      message: `Добавлено заказов: ${created}. Уже добавлены этим импортом: ${skipped}.`,
    });
  } catch (error) {
    if (transactionID !== null) await request.payload.db.rollbackTransaction(transactionID);
    if (error instanceof APIError) throw error;
    throw new APIError('Импорт отменён. Заказы не добавлены. Проверьте данные и повторите.', 400);
  } finally {
    importLocks.delete(lockKey);
  }
}

/** Preview and import routes share validation, while only the explicit import route writes data. */
export const bulkOrderEndpoints: Endpoint[] = [
  { path: '/bulk-preview', method: 'post', handler: (request) => bulkAction(request, false) },
  { path: '/bulk-import', method: 'post', handler: (request) => bulkAction(request, true) },
];
