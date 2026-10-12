/**
 * Cloudflare Worker between Telegram and the site on reg.ru: Telegram cannot reach the
 * hosting and the hosting cannot reach Telegram, while both reach Cloudflare.
 *
 * - POST /webhook/<bot id> — Telegram's webhook call, passed to that bot's site
 *   (src/api/bot.php) with the secret header; Telegram gets the site's answer, so its
 *   retries still work.
 * - /bot<token>/<method> — Bot API calls from the site, passed to api.telegram.org.
 *   Only for the bots in BOTS, so the relay cannot be used for other bots.
 *
 * Variables (worker/wrangler.toml): BOTS, bot id -> site's bot.php URL; the live and the
 * test site have separate bots.
 */

const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

/**
 * Passes Telegram's webhook call to the bot's site.
 * @param {Request} request
 * @param {string} botUrl The site's bot.php.
 * @returns {Promise<Response>} The site's answer.
 */
async function forwardWebhook(request, botUrl) {
  const response = await fetch(botUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // bot.php checks it; without it the call is rejected.
      [SECRET_HEADER]: request.headers.get(SECRET_HEADER) ?? '',
    },
    body: await request.text(),
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Passes a Bot API call from the site to Telegram.
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>} Telegram's answer as is.
 */
async function forwardApiCall(request, url) {
  return fetch(TELEGRAM_API_ORIGIN + url.pathname + url.search, {
    method: request.method,
    headers: { 'Content-Type': request.headers.get('Content-Type') ?? 'application/json' },
    body: request.method === 'GET' ? undefined : await request.text(),
  });
}

export default {
  /**
   * Routes a request to the webhook or the Bot API relay.
   * @param {Request} request
   * @param {{BOTS: Record<string, string>}} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const webhookBotId = url.pathname.match(/^\/webhook\/(\d+)$/)?.[1];
    if (webhookBotId && Object.hasOwn(env.BOTS, webhookBotId) && request.method === 'POST') {
      return forwardWebhook(request, env.BOTS[webhookBotId]);
    }
    // The token starts with the bot id: /bot<id>:<secret>/<method>.
    const apiBotId = url.pathname.match(/^\/bot(\d+):/)?.[1];
    if (apiBotId && Object.hasOwn(env.BOTS, apiBotId)) {
      return forwardApiCall(request, url);
    }
    return new Response('Not found', { status: 404 });
  },
};
