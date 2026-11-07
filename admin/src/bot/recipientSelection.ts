import { APIError, type Endpoint } from 'payload';
import { filterRecipientRows, type SelectionFilters } from '../editor/recipientSelection';
export { filterRecipientRows, updateRecipientSelection } from '../editor/recipientSelection';

/** Authenticated read-only query supports paged tables and explicit selection by all matching rows. */
export const recipientSelectionEndpoint: Endpoint = {
  path: '/recipients',
  method: 'post',
  handler: async (request) => {
    if (!request.user || request.user.collection !== 'users')
      throw new APIError('Нужен вход в админку.', 401);
    const input = (await request.json!()) as {
      collection?: unknown;
      payment?: unknown;
      products?: unknown;
      search?: unknown;
      page?: unknown;
      selectedIds?: unknown;
      selectedOnly?: unknown;
      allIds?: unknown;
    };
    if (
      !['members', 'orders'].includes(String(input.collection)) ||
      !['all', 'paid', 'unpaid'].includes(String(input.payment)) ||
      !Array.isArray(input.products) ||
      input.products.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      (input.selectedIds !== undefined &&
        (!Array.isArray(input.selectedIds) ||
          input.selectedIds.some((id) => !Number.isSafeInteger(id) || id <= 0))) ||
      (input.search !== undefined && typeof input.search !== 'string')
    )
      throw new APIError('Некорректные фильтры получателей.', 400);
    const [members, orders, products] = await Promise.all([
      request.payload.find({
        collection: 'members',
        pagination: false,
        depth: 0,
        sort: 'displayName',
      }),
      request.payload.find({
        collection: 'orders',
        pagination: false,
        depth: 0,
        sort: '-createdOnSite',
      }),
      request.payload.find({ collection: 'products', pagination: false, depth: 0 }),
    ]);
    const selectedIds = new Set((input.selectedIds ?? []) as number[]);
    const rows = filterRecipientRows(
      input.collection as 'members' | 'orders',
      members.docs,
      orders.docs,
      products.docs,
      {
        payment: input.payment as SelectionFilters['payment'],
        products: input.products as number[],
        search: (input.search ?? '') as string,
      },
    ).filter((row) => !input.selectedOnly || selectedIds.has(row.id));
    if (input.allIds === true)
      return Response.json({ ids: rows.map((row) => row.id), total: rows.length });
    const totalPages = Math.max(1, Math.ceil(rows.length / 25));
    const page = Math.min(
      totalPages,
      Math.max(1, Number.isSafeInteger(input.page) ? Number(input.page) : 1),
    );
    return Response.json({
      rows: rows.slice((page - 1) * 25, page * 25),
      total: rows.length,
      page,
      totalPages,
    });
  },
};
