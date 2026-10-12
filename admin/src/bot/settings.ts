/**
 * Settings from the environment. On the hosting the deploy writes them to
 * ~/private/<admin site>/env.json and the Passenger launcher passes them on.
 */
export const settings = {
  /** Bot token from @BotFather; without it the bot stays off and the panel still works. */
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  /**
   * Only the launcher on the hosting sets RUN_BOT=1: a second copy polling the same bot
   * (a local dev server, `next build`) would steal its updates.
   */
  runBot: process.env.RUN_BOT === '1',
  /** The site's orders folder, ~/private/<site>/orders, written by src/api/pay.php. */
  ordersDir: process.env.ORDERS_DIR ?? '',
  /** The site's prices.json (dist/api/prices.json), the list of plans and electives. */
  pricesFile: process.env.PRICES_FILE ?? '',
  /** The site's address for the {site} placeholder. */
  siteUrl: process.env.SITE_URL ?? 'https://brandmasterskaya.ru',
};
