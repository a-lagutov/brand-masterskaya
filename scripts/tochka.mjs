/**
 * Tochka API helper for setting up payments; run locally, never on CI.
 *
 *   TOCHKA_JWT=… node scripts/tochka.mjs customers
 *   TOCHKA_JWT=… node scripts/tochka.mjs retailers <customerCode>
 *   TOCHKA_JWT=… TOCHKA_CLIENT_ID=… node scripts/tochka.mjs webhook-get
 *   TOCHKA_JWT=… TOCHKA_CLIENT_ID=… node scripts/tochka.mjs webhook-set
 *
 * The JWT and client_id come from the internet bank: Сервисы → Интеграции и API → JWT-ключи.
 */

const API_URL = 'https://enter.tochka.com/uapi';
const WEBHOOK_URL = 'https://brandmasterskaya.ru/api/webhook.php';
const WEBHOOK_EVENTS = ['acquiringInternetPayment'];

/**
 * Reads a required environment variable or exits with a hint.
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Calls the Tochka API and prints the response.
 * @param {string} method
 * @param {string} apiPath Path after /uapi.
 * @param {object} [body] JSON body.
 * @returns {Promise<void>}
 */
async function callApi(method, apiPath, body) {
  const response = await fetch(API_URL + apiPath, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${requireEnv('TOCHKA_JWT')}`,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  console.log(response.status, JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
}

const [command, argument] = process.argv.slice(2);
const COMMANDS = {
  customers: () => callApi('GET', '/open-banking/v1.0/customers'),
  retailers: () =>
    callApi('GET', `/acquiring/v1.0/retailers?customerCode=${encodeURIComponent(argument ?? '')}`),
  'webhook-get': () => callApi('GET', `/webhook/v1.0/${requireEnv('TOCHKA_CLIENT_ID')}`),
  // PUT creates the webhook; the bank sends a test event and needs 200 from the site.
  'webhook-set': () =>
    callApi('PUT', `/webhook/v1.0/${requireEnv('TOCHKA_CLIENT_ID')}`, {
      webhooksList: WEBHOOK_EVENTS,
      url: WEBHOOK_URL,
    }),
};

if (!COMMANDS[command]) {
  console.error(`Commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}
await COMMANDS[command]();
