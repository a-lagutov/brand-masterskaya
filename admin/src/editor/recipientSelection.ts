import type { Member, Order, Product } from '../payload-types';
import { selectRecipients } from '../bot/messaging';

export type RecipientRow = {
  id: number;
  name: string;
  contact: string;
  products: string;
  payment: string;
};
export type SelectionFilters = {
  payment: 'all' | 'paid' | 'unpaid';
  products: number[];
  search: string;
};

/** Resolves populated relationships and IDs without relying on a relationship depth. */
function relationId(value: number | { id: number }): number {
  return typeof value === 'number' ? value : value.id;
}

/** Adds or removes matching rows without changing selections outside the current filter. */
export function updateRecipientSelection(
  current: number[],
  matching: number[],
  selected: boolean,
): number[] {
  const result = new Set(current);
  for (const id of matching) {
    if (selected) result.add(id);
    else result.delete(id);
  }
  return [...result];
}

/** Uses the broadcast's existing same-order predicates to build searchable recipient rows. */
export function filterRecipientRows(
  collection: 'members' | 'orders',
  members: Member[],
  orders: Order[],
  products: Pick<Product, 'id' | 'title'>[],
  filters: SelectionFilters,
): RecipientRow[] {
  const matchingMembers = selectRecipients(members, orders, {
    audience: 'all',
    payment: filters.payment,
    products: filters.products,
  });
  const matchingOrders = orders.filter(
    (order) =>
      !order.deletedAt &&
      (filters.payment === 'all' ||
        (filters.payment === 'paid' ? Boolean(order.paidAt) : !order.paidAt)) &&
      (!filters.products.length ||
        (order.products ?? []).some((product) => filters.products.includes(relationId(product)))),
  );
  /** Converts product relationships into readable table values. */
  function productTitles(order?: Order): string {
    return (order?.products ?? [])
      .map((value) => products.find((product) => product.id === relationId(value))?.title ?? '')
      .filter(Boolean)
      .join(', ');
  }
  const rows =
    collection === 'members'
      ? matchingMembers.map(({ member, order }) => ({
          id: member.id,
          name: member.displayName || member.telegramId,
          contact: [
            member.username ? `@${member.username}` : member.telegramId,
            order?.email,
            order?.phone,
          ]
            .filter(Boolean)
            .join(' · '),
          products: productTitles(order),
          payment: order ? (order.paidAt ? 'Оплачен' : 'Не оплачен') : 'Без заказа',
        }))
      : matchingOrders.map((order) => ({
          id: order.id,
          name: order.name || 'Без имени',
          contact: [order.email, order.phone, order.telegram].filter(Boolean).join(' · '),
          products: productTitles(order),
          payment: order.paidAt ? 'Оплачен' : 'Не оплачен',
        }));
  const search = filters.search.trim().toLocaleLowerCase('ru');
  return rows.filter(
    (row) =>
      !search ||
      `${row.name} ${row.contact} ${row.products}`.toLocaleLowerCase('ru').includes(search),
  );
}
