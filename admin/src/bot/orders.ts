import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { Payload } from 'payload';

import type { Order, Product } from '../payload-types';
import { findOrCreateMember } from './members';
import { settings } from './settings';

/** Order ids from src/api/pay.php: 32 hex characters. */
const ORDER_ID_PATTERN = /^[0-9a-f]{32}$/;

/** A purchased item as src/api/pay.php stores it. */
type SiteItem = { title: string; price: number };

/** An order file written by src/api/pay.php and src/api/lib.php. */
type SiteOrder = {
  id: string;
  createdAt?: string;
  name?: string;
  email?: string;
  phone?: string;
  telegram?: string;
  plan: SiteItem;
  electives: SiteItem[];
  planKey?: string;
  electiveKeys?: string[];
  total?: number;
  paidAt?: string | null;
  /** Set by the earlier PHP bot (src/api/bot.php) when it bound the order. */
  telegramUserId?: number;
};

/** The site's prices.json: plans and electives by key. */
type SitePrices = {
  plans: Record<string, { title: string; price: number }>;
  electives: Record<string, { title: string; price: number }>;
};

// Modification times of the order files already copied, so unchanged files are skipped.
const syncedFileTimes = new Map<string, number>();

/**
 * Brings the products list in line with the site's prices.json; prices and chats set in the
 * panel stay, a new product starts with the site's price.
 * @param payload
 */
export async function syncProducts(payload: Payload): Promise<void> {
  if (!settings.pricesFile) {
    return;
  }
  const prices = JSON.parse(await readFile(settings.pricesFile, 'utf8')) as SitePrices;
  const siteProducts = [
    ...Object.entries(prices.plans).map(([key, item]) => ({
      key,
      title: item.title,
      price: item.price,
      kind: 'plan' as const,
    })),
    ...Object.entries(prices.electives).map(([key, item]) => ({
      key,
      title: item.title,
      price: item.price,
      kind: 'elective' as const,
    })),
  ];
  for (const product of siteProducts) {
    const existing = await payload.find({
      collection: 'products',
      where: { key: { equals: product.key } },
      limit: 1,
      depth: 0,
    });
    const current = existing.docs[0];
    if (!current) {
      await payload.create({ collection: 'products', data: product });
    } else if (
      current.title !== product.title ||
      current.kind !== product.kind ||
      current.price == null
    ) {
      await payload.update({
        collection: 'products',
        id: current.id,
        // Products from before prices were edited here start with the site's price.
        data: { title: product.title, kind: product.kind, price: current.price ?? product.price },
      });
    }
  }
}

/**
 * Product ids for an order: by the stored keys, or by titles for orders made before the
 * keys were stored.
 * @param siteOrder
 * @param products All products.
 */
function orderProductIds(siteOrder: SiteOrder, products: Product[]): number[] {
  const items = [siteOrder.plan, ...siteOrder.electives];
  const matches = siteOrder.planKey
    ? products.filter((product) =>
        [siteOrder.planKey, ...(siteOrder.electiveKeys ?? [])].includes(product.key),
      )
    : products.filter((product) => items.some((item) => item.title === product.title));
  return matches.map((product) => product.id);
}

/**
 * Copies one order from the site into the panel, creating or updating it. An existing order
 * gets only the fields that changed on the site since the last copy, so edits made in the
 * panel stay until the site changes the same field.
 * @param payload
 * @param siteOrder
 * @returns The order in the panel.
 */
async function upsertOrder(payload: Payload, siteOrder: SiteOrder): Promise<Order> {
  const products = (await payload.find({ collection: 'products', limit: 100, depth: 0 })).docs;
  const siteData = {
    name: siteOrder.name ?? '',
    email: siteOrder.email || null,
    phone: siteOrder.phone ?? '',
    telegram: siteOrder.telegram ?? '',
    items: [siteOrder.plan, ...siteOrder.electives].map((item) => ({
      title: item.title,
      price: item.price,
    })),
    products: orderProductIds(siteOrder, products),
    total: siteOrder.total ?? 0,
    createdOnSite: siteOrder.createdAt ?? null,
    paidAt: siteOrder.paidAt ?? null,
  };
  const existing = (
    await payload.find({
      collection: 'orders',
      where: { orderId: { equals: siteOrder.id } },
      limit: 1,
      depth: 0,
      // A trashed order stays in the trash instead of coming back as a new one.
      trash: true,
    })
  ).docs[0];
  if (existing?.deletedAt) {
    return existing;
  }
  if (existing) {
    const lastCopy = (existing.siteCopy ?? {}) as Record<string, unknown>;
    const changed = Object.fromEntries(
      Object.entries(siteData).filter(
        ([field, value]) => JSON.stringify(value) !== JSON.stringify(lastCopy[field]),
      ),
    );
    if (!Object.keys(changed).length) {
      return existing;
    }
    return payload.update({
      collection: 'orders',
      id: existing.id,
      data: { ...changed, siteCopy: siteData },
      depth: 0,
    });
  }
  // Orders bound by the earlier PHP bot keep their account.
  const member = siteOrder.telegramUserId
    ? await findOrCreateMember(payload, { id: siteOrder.telegramUserId })
    : null;
  return payload.create({
    collection: 'orders',
    data: { ...siteData, orderId: siteOrder.id, siteCopy: siteData, member: member?.id },
    depth: 0,
  });
}

/**
 * Reads one order file from the site.
 * @param orderId Untrusted id, e.g. from /start.
 * @returns The order, or null when the id is malformed or there is no such order.
 */
async function readSiteOrder(orderId: string): Promise<SiteOrder | null> {
  if (!ORDER_ID_PATTERN.test(orderId) || !settings.ordersDir) {
    return null;
  }
  try {
    return JSON.parse(
      await readFile(path.join(settings.ordersDir, `${orderId}.json`), 'utf8'),
    ) as SiteOrder;
  } catch {
    return null;
  }
}

/**
 * Finds an order by its id, reading the site's file first so a payment made a second ago
 * is already seen; orders added in the panel have no file.
 * @param payload
 * @param orderId Untrusted id from /start.
 * @returns The order in the panel, or null when there is no such order or it is in the trash.
 */
export async function loadOrder(payload: Payload, orderId: string): Promise<Order | null> {
  const siteOrder = await readSiteOrder(orderId);
  if (siteOrder) {
    const order = await upsertOrder(payload, siteOrder);
    // An order deleted in the panel gives nothing.
    return order.deletedAt ? null : order;
  }
  if (!ORDER_ID_PATTERN.test(orderId)) {
    return null;
  }
  const panelOrders = await payload.find({
    collection: 'orders',
    where: { orderId: { equals: orderId } },
    limit: 1,
    depth: 0,
  });
  return panelOrders.docs[0] ?? null;
}

/**
 * Copies new and changed orders from the site; runs every minute.
 * @param payload
 */
export async function syncOrders(payload: Payload): Promise<void> {
  if (!settings.ordersDir) {
    return;
  }
  const fileNames = (await readdir(settings.ordersDir)).filter((fileName) =>
    /^[0-9a-f]{32}\.json$/.test(fileName),
  );
  for (const fileName of fileNames) {
    const filePath = path.join(settings.ordersDir, fileName);
    const modifiedAt = (await stat(filePath)).mtimeMs;
    if (syncedFileTimes.get(fileName) === modifiedAt) {
      continue;
    }
    const siteOrder = await readSiteOrder(fileName.slice(0, -'.json'.length));
    if (siteOrder) {
      await upsertOrder(payload, siteOrder);
      syncedFileTimes.set(fileName, modifiedAt);
    }
  }
}
