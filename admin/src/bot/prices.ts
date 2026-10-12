import { rename, writeFile } from 'node:fs/promises';

import type { Payload } from 'payload';

import { settings } from './settings';

/**
 * Writes the prices set in the panel for the site: {"<key>": <rubles>, ...}. The site's
 * src/api/lib.php charges them and src/api/prices.php shows them on the page.
 * @param payload
 */
export async function writePriceOverrides(payload: Payload): Promise<void> {
  if (!settings.priceOverridesFile) {
    return;
  }
  const products = await payload.find({ collection: 'products', limit: 100, depth: 0 });
  const prices = Object.fromEntries(
    products.docs
      .filter((product) => Number.isInteger(product.price) && (product.price ?? 0) > 0)
      .map((product) => [product.key, product.price]),
  );
  // The site may read the file at any moment; a rename never leaves it half-written.
  const temporaryFile = `${settings.priceOverridesFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(prices));
  await rename(temporaryFile, settings.priceOverridesFile);
  payload.logger.info({ prices }, 'prices written for the site');
}
