import { rename, writeFile } from 'node:fs/promises';

import type { Payload } from 'payload';

import { settings } from './settings';

/**
 * Writes the switches for the site: {"hideDolyame": <bool>}. src/api/prices.php reads them to
 * decide whether the page shows the Dolyame button.
 * @param payload
 */
export async function writeSiteSettings(payload: Payload): Promise<void> {
  if (!settings.siteSettingsFile) {
    return;
  }
  const siteSettings = await payload.findGlobal({ slug: 'site-settings', depth: 0 });
  const forSite = { hideDolyame: siteSettings.hideDolyame !== false };
  // The site may read the file at any moment; a rename never leaves it half-written.
  const temporaryFile = `${settings.siteSettingsFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(forSite));
  await rename(temporaryFile, settings.siteSettingsFile);
  payload.logger.info(forSite, 'site settings written for the site');
}
