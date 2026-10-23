import * as migration_20261012_024248_initial from './20261012_024248_initial';
import * as migration_20261012_035348_order_edits_prices from './20261012_035348_order_edits_prices';
import * as migration_20261012_035934_orders_trash from './20261012_035934_orders_trash';
import * as migration_20261012_042732_bot_start_text from './20261012_042732_bot_start_text';
import * as migration_20261012_043143_bot_text_links from './20261012_043143_bot_text_links';
import * as migration_20261019_155241_promo_codes from './20261019_155241_promo_codes';
import * as migration_20261019_161222_promo_discounts from './20261019_161222_promo_discounts';
import * as migration_20261020_121529_site_settings from './20261020_121529_site_settings';
import * as migration_20261023_131938_contacts from './20261023_131938_contacts';
import * as migration_20261023_141149_legal from './20261023_141149_legal';

export const migrations = [
  {
    up: migration_20261012_024248_initial.up,
    down: migration_20261012_024248_initial.down,
    name: '20261012_024248_initial',
  },
  {
    up: migration_20261012_035348_order_edits_prices.up,
    down: migration_20261012_035348_order_edits_prices.down,
    name: '20261012_035348_order_edits_prices',
  },
  {
    up: migration_20261012_035934_orders_trash.up,
    down: migration_20261012_035934_orders_trash.down,
    name: '20261012_035934_orders_trash',
  },
  {
    up: migration_20261012_042732_bot_start_text.up,
    down: migration_20261012_042732_bot_start_text.down,
    name: '20261012_042732_bot_start_text',
  },
  {
    up: migration_20261012_043143_bot_text_links.up,
    down: migration_20261012_043143_bot_text_links.down,
    name: '20261012_043143_bot_text_links',
  },
  {
    up: migration_20261019_155241_promo_codes.up,
    down: migration_20261019_155241_promo_codes.down,
    name: '20261019_155241_promo_codes',
  },
  {
    up: migration_20261019_161222_promo_discounts.up,
    down: migration_20261019_161222_promo_discounts.down,
    name: '20261019_161222_promo_discounts',
  },
  {
    up: migration_20261020_121529_site_settings.up,
    down: migration_20261020_121529_site_settings.down,
    name: '20261020_121529_site_settings',
  },
  {
    up: migration_20261023_131938_contacts.up,
    down: migration_20261023_131938_contacts.down,
    name: '20261023_131938_contacts',
  },
  {
    up: migration_20261023_141149_legal.up,
    down: migration_20261023_141149_legal.down,
    name: '20261023_141149_legal'
  },
];
