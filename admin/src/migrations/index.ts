import * as migration_20261012_024248_initial from './20261012_024248_initial';
import * as migration_20261012_035348_order_edits_prices from './20261012_035348_order_edits_prices';

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
];
