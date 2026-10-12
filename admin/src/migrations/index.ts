import * as migration_20261012_024248_initial from './20261012_024248_initial';
import * as migration_20261012_035348_order_edits_prices from './20261012_035348_order_edits_prices';
import * as migration_20261012_035934_orders_trash from './20261012_035934_orders_trash';
import * as migration_20261012_042732_bot_start_text from './20261012_042732_bot_start_text';

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
    name: '20261012_042732_bot_start_text'
  },
];
