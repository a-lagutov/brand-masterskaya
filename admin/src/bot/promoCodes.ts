import { rename, writeFile } from 'node:fs/promises';

import type { Payload } from 'payload';

import type { Product } from '../payload-types';
import { settings } from './settings';

/** A promo code as the site reads it: src/api/lib.php, find_promo_code(). */
type SitePromoCode = { percent: number; plans: string[]; validUntil: string | null };

/**
 * Writes the active promo codes for the site: {"<CODE>": {percent, plans, validUntil}, ...}.
 * Only plan keys go in: electives are never discounted. src/api/lib.php checks the code and
 * its expiry and charges the discounted price.
 * @param payload
 */
export async function writePromoCodes(payload: Payload): Promise<void> {
  if (!settings.promoCodesFile) {
    return;
  }
  const promoCodes = await payload.find({
    collection: 'promo-codes',
    where: { active: { equals: true } },
    limit: 1000,
    depth: 1,
  });
  const siteCodes: Record<string, SitePromoCode> = Object.fromEntries(
    promoCodes.docs.map((promoCode) => [
      promoCode.code,
      {
        percent: promoCode.percent,
        plans: (promoCode.plans ?? [])
          .filter((plan): plan is Product => typeof plan === 'object' && plan.kind === 'plan')
          .map((plan) => plan.key),
        validUntil: promoCode.validUntil ?? null,
      },
    ]),
  );
  // The site may read the file at any moment; a rename never leaves it half-written.
  const temporaryFile = `${settings.promoCodesFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(siteCodes));
  await rename(temporaryFile, settings.promoCodesFile);
  payload.logger.info({ codes: Object.keys(siteCodes) }, 'promo codes written for the site');
}
