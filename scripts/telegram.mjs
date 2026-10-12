/**
 * Telegram Bot API helper for setting up the bot; run locally, never on CI.
 *
 *   TG_BOT_MASTERSKAYA_TOKEN=… node scripts/telegram.mjs me
 *   TG_BOT_MASTERSKAYA_TOKEN=… node scripts/telegram.mjs webhook-get
 *   TG_BOT_MASTERSKAYA_TOKEN=… node scripts/telegram.mjs webhook-set <relay url>
 *
 * Add --test to work with the test site's bot from TG_TESTBOT_MASTERSKAYA_TOKEN.
 *
 * The webhook points at the Cloudflare relay (worker/), which passes calls to the bot's site
 * set in worker/wrangler.toml: Telegram cannot reach the hosting directly. The bot has one
 * webhook; setting it takes the bot away from any other service that used it before.
 */
import { createHmac } from 'node:crypto';

const API_URL = 'https://api.telegram.org/bot';
// Updates src/api/bot.php handles; Telegram does not send the others.
const ALLOWED_UPDATES = ['message', 'chat_join_request', 'my_chat_member'];

const isTestBot = process.argv.includes('--test');
const [command, argument] = process.argv.slice(2).filter((value) => value !== '--test');

/**
 * Reads the token of the live bot, or of the test bot with --test, or exits with a hint.
 * @returns {string}
 */
function requireToken() {
  const variable = isTestBot ? 'TG_TESTBOT_MASTERSKAYA_TOKEN' : 'TG_BOT_MASTERSKAYA_TOKEN';
  const token = process.env[variable];
  if (!token) {
    console.error(`Set ${variable}`);
    process.exit(1);
  }
  return token;
}

/**
 * The secret Telegram sends with every webhook call; telegram_webhook_secret() in
 * src/api/lib.php derives the same value from the token.
 * @param {string} token
 * @returns {string}
 */
function webhookSecret(token) {
  return createHmac('sha256', token).update('telegram-webhook').digest('hex');
}

/**
 * Calls the Bot API and prints the response.
 * @param {string} method
 * @param {object} [body] JSON body.
 * @returns {Promise<void>}
 */
async function callApi(method, body) {
  const response = await fetch(`${API_URL}${requireToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  console.log(response.status, JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
}

const COMMANDS = {
  me: () => callApi('getMe'),
  'webhook-get': () => callApi('getWebhookInfo'),
  'webhook-set': () => {
    if (!argument) {
      console.error(
        'Pass the relay URL, e.g. https://brandmasterskaya-telegram.<account>.workers.dev',
      );
      process.exit(1);
    }
    // The relay picks the site by the bot id, the part of the token before the colon.
    const botId = requireToken().split(':')[0];
    return callApi('setWebhook', {
      url: `${argument.replace(/\/+$/, '')}/webhook/${botId}`,
      secret_token: webhookSecret(requireToken()),
      allowed_updates: ALLOWED_UPDATES,
      // Updates queued for the previous service would reach the bot out of context.
      drop_pending_updates: true,
    });
  },
};

if (!COMMANDS[command]) {
  console.error(`Commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}
await COMMANDS[command]();
