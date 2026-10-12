/**
 * Cloudflare Worker that passes Bot API calls from the bot in admin/ to api.telegram.org.
 *
 * From the reg.ru hosting, IPv4 connections to api.telegram.org hang for about two minutes,
 * while Cloudflare is reachable at once. The bot uses this Worker as its API root:
 * /bot<token>/<method> here is /bot<token>/<method> at Telegram.
 *
 * Only the bots in BOT_IDS (worker/wrangler.toml), so the relay cannot be used for other bots.
 */

const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';

/**
 * Passes a Bot API call to Telegram.
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>} Telegram's answer as is.
 */
async function forwardApiCall(request, url) {
  return fetch(TELEGRAM_API_ORIGIN + url.pathname + url.search, {
    method: request.method,
    headers: { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' },
    body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
  });
}

export default {
  /**
   * Relays calls of the known bots and rejects everything else.
   * @param {Request} request
   * @param {{BOT_IDS: string[]}} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    // The token starts with the bot id: /bot<id>:<secret>/<method>.
    const botId = url.pathname.match(/^\/bot(\d+):/)?.[1];
    if (botId && env.BOT_IDS.includes(botId)) {
      return forwardApiCall(request, url);
    }
    return new Response('Not found', { status: 404 });
  },
};
