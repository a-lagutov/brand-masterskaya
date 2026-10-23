<?php
/**
 * Shared code for the payment endpoints: catalog, config, order storage, Tochka API calls,
 * webhook signature check, emails and the link to the Telegram bot.
 *
 * The bot itself lives in admin/ and reads the orders written here.
 *
 * Secrets and orders live outside the web root (see private_dir()), so a deploy
 * with rsync --delete never touches them and they are never served over HTTP.
 */

declare(strict_types=1);

// A library, not an endpoint.
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

// Plans from src/prices.json (copied next to this file by the build) with the prices set in
// the admin panel. Prices are checked here, not trusted from the browser.
define('PRICES', load_prices());
const PLANS = PRICES['plans'];
const ELECTIVES = PRICES['electives'];
// Electives can only be added to this plan.
const ELECTIVES_PLAN = PRICES['electivesPlan'];
const PRODUCT_NAME = 'Мастерская бренд-стратегии';
// Salebot link to the Telegram bot, used while no bot is configured;
// the application travels in the query string.
const APPLICATION_LINK = 'https://link.brandmasterskaya.ru/r/zayavka_1';
const TOCHKA_PRODUCTION_URL = 'https://enter.tochka.com/uapi';
const TOCHKA_SANDBOX_URL = 'https://enter.tochka.com/sandbox/v2';
const TOCHKA_SANDBOX_TOKEN = 'sandbox.jwt.token';
// Dolyame accepts order ids up to 30 characters; our ids have 32, so Dolyame gets their prefix.
const DOLYAME_ORDER_ID_LENGTH = 30;
const DOLYAME_URL = 'https://partner.dolyame.ru/v1';
// Dolyame sends notifications only from these networks.
const DOLYAME_WEBHOOK_NETWORKS = ['91.194.226.0/23', '91.218.132.0/22', '212.233.80.0/22'];
const TOCHKA_PUBLIC_KEY_URL = 'https://enter.tochka.com/doc/openapi/static/keys/public';
// The webhook key rarely changes; refetch it once a day.
const PUBLIC_KEY_CACHE_SECONDS = 86400;
// After a failed check, refetch at most this often, so junk requests do not hammer the bank.
const PUBLIC_KEY_REFRESH_SECONDS = 300;
const ORDER_ID_PATTERN = '/^[a-f0-9]{32}$/';
// Promo codes as the admin panel stores them: upper case, Latin letters, digits, - and _.
const PROMO_CODE_PATTERN = '/^[A-Z0-9_-]{3,32}$/';

/**
 * Directory with config.php, orders/ and caches, outside the web root:
 * ~/private/<site folder>, so the live and the test site keep separate data.
 * @return string Absolute path without a trailing slash.
 */
function private_dir(): string
{
    $override = getenv('BM_PRIVATE_DIR');
    if ($override) {
        return rtrim($override, '/');
    }
    // api/ -> site root (www/<domain>) -> www/ -> home directory.
    return dirname(__DIR__, 3) . '/private/' . basename(dirname(__DIR__));
}

/**
 * Plans and electives from prices.json next to this file, with prices replaced by those the
 * admin panel (admin/) writes to prices.json in private_dir(): {"<key>": <rubles>, ...}.
 * @return array<string, mixed> The structure of src/prices.json.
 */
function load_prices(): array
{
    $prices = json_decode((string) file_get_contents(__DIR__ . '/prices.json'), true, 512, JSON_THROW_ON_ERROR);
    $overridesFile = private_dir() . '/prices.json';
    $overrides = is_file($overridesFile)
        ? json_decode((string) file_get_contents($overridesFile), true)
        : null;
    if (!is_array($overrides)) {
        return $prices;
    }
    foreach (['plans', 'electives'] as $group) {
        foreach (array_keys($prices[$group]) as $key) {
            $price = $overrides[$key] ?? null;
            // A broken or zero price must never reach the bank.
            if (is_int($price) && $price > 0) {
                $prices[$group][$key]['price'] = $price;
            }
        }
    }
    return $prices;
}

/**
 * Finds an active promo code in promocodes.json, which the admin panel (admin/) writes to
 * private_dir(): {"<CODE>": {"discounts": {"<key>": <percent>}, "validUntil": "<ISO>"|null}},
 * where a key is a plan or an elective from prices.json.
 * @param string $code Untrusted code as the buyer typed it; case and spaces do not matter.
 * @return array{code: string, discounts: array<string, int>}|null Null when unknown, expired,
 *   malformed or covering nothing on sale.
 */
function find_promo_code(string $code): ?array
{
    $code = strtoupper(trim($code));
    $codesFile = private_dir() . '/promocodes.json';
    if (!preg_match(PROMO_CODE_PATTERN, $code) || !is_file($codesFile)) {
        return null;
    }
    $codes = json_decode((string) file_get_contents($codesFile), true);
    $promo = is_array($codes) ? ($codes[$code] ?? null) : null;
    if (!is_array($promo)) {
        return null;
    }
    $validUntil = $promo['validUntil'] ?? null;
    if (is_string($validUntil) && strtotime($validUntil) !== false && strtotime($validUntil) < time()) {
        return null;
    }
    // Only known plans and electives with a sane percent: a broken one must never make a zero
    // or negative price.
    $discounts = array_filter(
        (array) ($promo['discounts'] ?? []),
        fn($percent, $key) => (isset(PLANS[$key]) || isset(ELECTIVES[$key]))
            && is_int($percent) && $percent >= 1 && $percent <= 99,
        ARRAY_FILTER_USE_BOTH,
    );
    return $discounts ? ['code' => $code, 'discounts' => $discounts] : null;
}

/**
 * Discount in rubles for a price, rounded to whole rubles; the same formula as src/js/app.js.
 * At least 1 ruble, so a code never gives nothing on a tiny price, and never more than leaves
 * 1 ruble, which the bank needs.
 * @param int $price Full price in rubles.
 * @param int $percent 1–99.
 * @return int
 */
function promo_discount(int $price, int $percent): int
{
    return max(0, min($price - 1, max(1, (int) round($price * $percent / 100))));
}

/**
 * Loads config.php once and fills in defaults.
 * @return array<string, mixed>
 */
function config(): array
{
    static $config = null;
    if ($config === null) {
        $loaded = require private_dir() . '/config.php';
        $config = array_merge([
            'sandbox' => false,
            'tochka_jwt' => '',
            'customer_code' => '',
            'merchant_id' => '',
            'tax_system_code' => 'usn_income',
            'vat_type' => 'none',
            'payment_method' => 'full_payment',
            'payment_modes' => ['card', 'sbp', 'dolyame'],
            'site_url' => 'https://brandmasterskaya.ru',
            'mail_from' => 'noreply@brandmasterskaya.ru',
            'notify_email' => '',
            // Dolyame (installments): Basic login/password plus the mTLS certificate and key,
            // which the deploy writes next to config.php. Empty login — Dolyame is off.
            'dolyame_login' => '',
            'dolyame_password' => '',
            'telegram_bot_username' => '',
        ], $loaded);
    }
    return $config;
}

/**
 * Sends a JSON response and stops the script.
 * @param int $status HTTP status code.
 * @param array<string, mixed> $body
 */
function respond_json(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Writes a line to the private log, never to the response.
 * @param string $message
 */
function log_event(string $message): void
{
    $line = date('c') . ' ' . $message . PHP_EOL;
    @file_put_contents(private_dir() . '/payments.log', $line, FILE_APPEND | LOCK_EX);
}

/**
 * Calls the Tochka API.
 * @param string $method HTTP method.
 * @param string $path Path after the base URL, e.g. /acquiring/v1.0/payments.
 * @param array<string, mixed>|null $body JSON body.
 * @return array<string, mixed> Decoded response.
 * @throws RuntimeException On network errors and non-2xx responses.
 */
function tochka_request(string $method, string $path, ?array $body = null): array
{
    $sandbox = (bool) config()['sandbox'];
    $baseUrl = $sandbox ? TOCHKA_SANDBOX_URL : TOCHKA_PRODUCTION_URL;
    $token = $sandbox ? TOCHKA_SANDBOX_TOKEN : config()['tochka_jwt'];
    $curl = curl_init($baseUrl . $path);
    $headers = ['Accept: application/json', 'Authorization: Bearer ' . $token];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    if ($raw === false) {
        throw new RuntimeException("Tochka $method $path: $error");
    }
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("Tochka $method $path: HTTP $status $raw");
    }
    return json_decode((string) $raw, true) ?? [];
}

/**
 * Random UUID v4, the format Dolyame requires in X-Correlation-ID.
 * @return string
 */
function uuid_v4(): string
{
    $bytes = random_bytes(16);
    // Version 4 and RFC 4122 variant bits.
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

/**
 * Whether Dolyame is configured: credentials, certificate and key are all present.
 * @return bool
 */
function dolyame_enabled(): bool
{
    return config()['dolyame_login'] !== ''
        && is_file(private_dir() . '/dolyame-cert.pem')
        && is_file(private_dir() . '/dolyame-key.pem');
}

/**
 * Whether the page may show the Dolyame button: Dolyame is configured and the admin panel
 * (admin/, "Настройки сайта") has not hidden it. The panel writes site-settings.json to
 * private_dir(); without the file the button stays hidden.
 * @return bool
 */
function dolyame_button_visible(): bool
{
    if (!dolyame_enabled()) {
        return false;
    }
    return (site_settings()['hideDolyame'] ?? true) === false;
}

/**
 * Reads site-settings.json, which the admin panel writes to private_dir().
 * @return array Empty when the file is missing or unreadable.
 */
function site_settings(): array
{
    $settingsFile = private_dir() . '/site-settings.json';
    $siteSettings = is_file($settingsFile)
        ? json_decode((string) file_get_contents($settingsFile), true)
        : null;
    return is_array($siteSettings) ? $siteSettings : [];
}

/**
 * Defaults for the contacts and legal details: src/legal/defaults.json, which the build copies
 * next to this file (api/legal/). The admin panel overrides them.
 * @return array{contacts: array<string, string>, legal: array<string, string>}
 */
function legal_defaults(): array
{
    static $defaults = null;
    if ($defaults === null) {
        $defaults = json_decode((string) file_get_contents(__DIR__ . '/legal/defaults.json'), true, 512, JSON_THROW_ON_ERROR);
    }
    return $defaults;
}

/**
 * Contacts for the page, the letter to the buyer and the legal documents: set in the admin
 * panel ("Настройки сайта"), otherwise the defaults.
 * @return array{phone: string, phoneText: string, telegram: string, email: string}
 */
function site_contacts(): array
{
    $defaults = legal_defaults()['contacts'];
    $siteSettings = site_settings();
    $phone = (string) ($siteSettings['contactPhone'] ?? '');
    $telegram = (string) ($siteSettings['contactTelegram'] ?? '');
    $email = (string) ($siteSettings['contactEmail'] ?? '');
    // A broken value never reaches the page: each field falls back on its own.
    if (!preg_match('/^\+[1-9]\d{7,14}$/', $phone)) {
        $phone = $defaults['phone'];
    }
    if (!preg_match('/^[A-Za-z0-9_]{5,32}$/', $telegram)) {
        $telegram = $defaults['telegram'];
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $email = $defaults['email'];
    }
    // Russian numbers are written +7 915 044-69-75; others stay as stored.
    $phoneText = preg_match('/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/', $phone, $parts)
        ? "+7 {$parts[1]} {$parts[2]}-{$parts[3]}-{$parts[4]}"
        : $phone;
    return ['phone' => $phone, 'phoneText' => $phoneText, 'telegram' => $telegram, 'email' => $email];
}

/**
 * Legal details of the seller for the pages: set in the admin panel ("Настройки сайта"),
 * otherwise the defaults.
 * @return array<string, string>
 */
function site_legal(): array
{
    $legal = legal_defaults()['legal'];
    // Digit-only details must have the exact length; a broken one keeps its default.
    $digitPatterns = [
        'inn' => '/^(\d{10}|\d{12})$/',
        'ogrnip' => '/^\d{15}$/',
        'bankAccount' => '/^\d{20}$/',
        'bik' => '/^\d{9}$/',
        'correspondentAccount' => '/^\d{20}$/',
    ];
    $fromPanel = site_settings()['legal'] ?? [];
    foreach ($legal as $key => $default) {
        $value = is_array($fromPanel) ? trim((string) ($fromPanel[$key] ?? '')) : '';
        $valid = $value !== '' && mb_strlen($value) <= 200
            && (!isset($digitPatterns[$key]) || preg_match($digitPatterns[$key], $value));
        $legal[$key] = $valid ? $value : $default;
    }
    return $legal;
}

/**
 * A legal document with its {{variables}} filled: the text saved in the admin panel
 * (legal-<name>.html in private_dir()), or the one shipped with the site (api/legal/<name>.html).
 * Values are escaped, the text itself is the owners' HTML; a text with scripts is ignored.
 * @param string $name oferta or privacy.
 * @return string HTML for inside <main>.
 */
function render_legal_document(string $name): string
{
    $shipped = (string) file_get_contents(__DIR__ . "/legal/$name.html");
    $savedFile = private_dir() . "/legal-$name.html";
    $saved = is_file($savedFile) ? (string) file_get_contents($savedFile) : '';
    $unsafe = preg_match('/<\s*(script|iframe|object|embed)\b|\son\w+\s*=|javascript:/i', $saved) === 1;
    $template = trim($saved) !== '' && !$unsafe ? $saved : $shipped;
    $siteUrl = rtrim((string) config()['site_url'], '/');
    $values = [
        ...site_legal(),
        ...site_contacts(),
        'site' => $siteUrl,
        'domain' => (string) parse_url($siteUrl, PHP_URL_HOST),
    ];
    return preg_replace_callback(
        '/\{\{(\w+)\}\}/',
        // An unknown variable stays visible, so a typo is noticed.
        static fn (array $match): string => isset($values[$match[1]])
            ? htmlspecialchars($values[$match[1]], ENT_QUOTES)
            : $match[0],
        $template,
    );
}

/**
 * Calls the Dolyame partner API over mTLS with Basic auth.
 * @param string $method HTTP method.
 * @param string $path Path after the base URL, e.g. /orders/create.
 * @param array<string, mixed>|null $body JSON body.
 * @return array<string, mixed> Decoded response.
 * @throws RuntimeException On network errors and non-2xx responses.
 */
function dolyame_request(string $method, string $path, ?array $body = null): array
{
    $config = config();
    $curl = curl_init(DOLYAME_URL . $path);
    $headers = [
        'Accept: application/json',
        // Lets Dolyame support trace a request; also makes retries recognisable.
        'X-Correlation-ID: ' . uuid_v4(),
    ];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERPWD => $config['dolyame_login'] . ':' . $config['dolyame_password'],
        CURLOPT_SSLCERT => private_dir() . '/dolyame-cert.pem',
        CURLOPT_SSLKEY => private_dir() . '/dolyame-key.pem',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    if ($raw === false) {
        throw new RuntimeException("Dolyame $method $path: $error");
    }
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException("Dolyame $method $path: HTTP $status $raw");
    }
    return json_decode((string) $raw, true) ?? [];
}

/**
 * Whether an IPv4 address lies in a CIDR network.
 * @param string $address
 * @param string $network e.g. 91.194.226.0/23.
 * @return bool
 */
function ip_in_network(string $address, string $network): bool
{
    [$base, $bits] = explode('/', $network);
    $mask = -1 << (32 - (int) $bits);
    $addressNumber = ip2long($address);
    return $addressNumber !== false && (($addressNumber & $mask) === (ip2long($base) & $mask));
}

/**
 * The id Dolyame knows an order by: the first 30 characters of ours.
 * @param string $orderId Our 32-character order id.
 * @return string
 */
function dolyame_order_id(string $orderId): string
{
    return substr($orderId, 0, DOLYAME_ORDER_ID_LENGTH);
}

/**
 * Finds our order id by the shortened id Dolyame sends in notifications.
 * @param string $dolyameId Untrusted id from a notification.
 * @return string|null Our full order id, null when malformed or unknown.
 */
function order_id_from_dolyame_id(string $dolyameId): ?string
{
    if (!preg_match('/^[a-f0-9]{' . DOLYAME_ORDER_ID_LENGTH . '}$/', $dolyameId)) {
        return null;
    }
    $files = glob(private_dir() . '/orders/' . $dolyameId . '*.json') ?: [];
    return $files ? basename($files[0], '.json') : null;
}

/**
 * Lines of an order as Dolyame items: one per purchased part, with the 54-FZ fields for
 * Dolyame's receipt service. The service is handed over at once, so one "full payment" receipt.
 * @param array<string, mixed> $order
 * @return list<array<string, mixed>>
 */
function dolyame_items(array $order): array
{
    $vatType = config()['vat_type'];
    return array_map(fn($item) => [
        'name' => PRODUCT_NAME . ': ' . $item['title'],
        'quantity' => 1,
        'price' => $item['price'],
        'receipt' => [
            'tax' => $vatType,
            'payment_method' => 'full_payment',
            'payment_object' => 'service',
            'measurement_unit' => 'шт',
        ],
    ], array_merge([$order['plan']], $order['electives']));
}

/**
 * Brings a Dolyame order up to date with the bank: confirms (commit) an application that
 * waits for it and marks the order paid once Dolyame has accepted it. Safe to call from the
 * webhook and the thank-you page at the same time.
 * @param string $orderId A known order id.
 * @return string Dolyame status, or '' when it could not be fetched.
 */
function dolyame_sync(string $orderId): string
{
    $order = load_order($orderId);
    if ($order === null || ($order['provider'] ?? '') !== 'dolyame') {
        return '';
    }
    try {
        $info = dolyame_request('GET', '/orders/' . dolyame_order_id($orderId) . '/info');
        $status = (string) ($info['status'] ?? '');
        if (in_array($status, ['wait_for_commit', 'waiting_for_commit'], true)) {
            // The shop gets the money only after the commit; the service is sold at once.
            $info = dolyame_request('POST', '/orders/' . dolyame_order_id($orderId) . '/commit', [
                'amount' => $order['total'],
                'items' => dolyame_items($order),
                // Receipts for exactly the items sold; none were added or dropped since create.
                'fiscalization_settings' => [
                    'type' => 'enabled',
                    'params' => [
                        'create_receipt_for_committed_items' => true,
                        'create_receipt_for_added_items' => false,
                        'create_receipt_for_returned_items' => false,
                    ],
                ],
            ]);
            $status = (string) ($info['status'] ?? 'committed');
        }
    } catch (RuntimeException $exception) {
        log_event("dolyame sync failed order=$orderId " . $exception->getMessage());
        return '';
    }
    if (in_array($status, ['committed', 'completed'], true)) {
        mark_paid($orderId, 'dolyame');
    }
    return $status;
}

/**
 * Path of an order file.
 * @param string $orderId 32 hex characters.
 * @return string
 */
function order_path(string $orderId): string
{
    return private_dir() . '/orders/' . $orderId . '.json';
}

/**
 * Reads an order.
 * @param string $orderId Untrusted id from a request or webhook.
 * @return array<string, mixed>|null Null when the id is malformed or unknown.
 */
function load_order(string $orderId): ?array
{
    if (!preg_match(ORDER_ID_PATTERN, $orderId) || !is_file(order_path($orderId))) {
        return null;
    }
    return json_decode((string) file_get_contents(order_path($orderId)), true);
}

/**
 * Writes an order atomically.
 * @param array<string, mixed> $order Must contain 'id'.
 */
function save_order(array $order): void
{
    $directory = private_dir() . '/orders';
    if (!is_dir($directory)) {
        mkdir($directory, 0700, true);
    }
    $temporaryPath = order_path($order['id']) . '.tmp';
    file_put_contents(
        $temporaryPath,
        json_encode($order, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
    );
    rename($temporaryPath, order_path($order['id']));
}

/**
 * Builds the link the customer opens after paying: the bot with the order id as the
 * /start parameter, or the old Salebot link while the bot is not configured.
 * @param array<string, mixed> $order
 * @return string
 */
function telegram_link(array $order): string
{
    if (config()['telegram_bot_username'] !== '') {
        // The id is the order's only access token, as on the thank-you page; the bot
        // reads the order itself, so nothing in the link can be forged.
        return 'https://t.me/' . config()['telegram_bot_username'] . '?start=' . $order['id'];
    }
    return salebot_link($order);
}

/**
 * Builds the Salebot link with the application in the query string.
 * @param array<string, mixed> $order
 * @return string
 */
function salebot_link(array $order): string
{
    $electiveTitles = array_map(fn($item) => $item['title'], $order['electives']);
    $electivesPrice = array_sum(array_map(fn($item) => $item['price'], $order['electives']));
    return APPLICATION_LINK . '?' . http_build_query([
        'name' => $order['name'],
        'email' => $order['email'],
        'phone' => $order['phone'],
        'telegram' => $order['telegram'] ?? '',
        'plan' => $order['plan']['title'],
        'plan_price' => $order['plan']['price'],
        'electives' => implode(', ', $electiveTitles),
        'electives_price' => $electivesPrice,
        'total' => $order['total'],
        'currency' => 'RUB',
        'order' => $order['id'],
    ], '', '&', PHP_QUERY_RFC3986);
}

/**
 * Runs an update of an order while holding its lock, so concurrent requests
 * (webhook, thank-you page, bot) change it one at a time.
 * @param string $orderId A known order id.
 * @param callable(): mixed $update Re-reads the order, changes and saves it.
 * @return mixed What $update returns.
 */
function with_order_lock(string $orderId, callable $update): mixed
{
    $lock = fopen(order_path($orderId) . '.lock', 'c');
    flock($lock, LOCK_EX);
    try {
        return $update();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/**
 * Sends a plain-text UTF-8 email through the hosting's sendmail.
 * @param string $to Recipient address.
 * @param string $subject
 * @param string $text Body.
 * @param string $bcc Hidden copy, e.g. to keep sent mail in a mailbox; empty for none.
 * @return bool Whether sendmail accepted the message.
 */
function send_mail(string $to, string $subject, string $text, string $bcc = ''): bool
{
    $from = config()['mail_from'];
    $headers = [
        'From' => '=?UTF-8?B?' . base64_encode(PRODUCT_NAME) . "?= <$from>",
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => 'base64',
    ];
    if ($bcc !== '') {
        $headers['Bcc'] = $bcc;
    }
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    // -f sets the envelope sender so SPF on the domain applies.
    return mail($to, $encodedSubject, chunk_split(base64_encode($text)), $headers, '-f' . $from);
}

/**
 * Marks an order paid and emails the customer (and the organizers) exactly once,
 * even when the webhook and the thank-you page report the payment at the same time.
 * @param string $orderId
 * @param string $paymentType card, sbp, … when known.
 * @return array<string, mixed>|null The order after the update.
 */
function mark_paid(string $orderId, string $paymentType = ''): ?array
{
    if (!load_order($orderId)) {
        return null;
    }
    return with_order_lock($orderId, function () use ($orderId, $paymentType) {
        // Re-read under the lock: another request may have finished first.
        $order = load_order($orderId);
        if (!empty($order['paidAt'])) {
            return $order;
        }
        $order['paidAt'] = date('c');
        $order['paymentType'] = $paymentType;
        save_order($order);
        log_event("paid order=$orderId total={$order['total']} type=$paymentType");
        notify_paid($order);
        return $order;
    });
}

/**
 * Emails the Telegram link to the customer and a summary to the organizers.
 * @param array<string, mixed> $order A paid order.
 */
function notify_paid(array $order): void
{
    $link = telegram_link($order);
    $electives = array_map(fn($item) => $item['title'], $order['electives']);
    $format = $order['plan']['title'] . ($electives ? ' + ' . implode(', ', $electives) : '');
    $total = number_format($order['total'], 0, ',', ' ') . ' ₽';
    $contacts = site_contacts();
    $customerText = "Здравствуйте, {$order['name']}!\n\n"
        . "Оплата участия в программе «" . PRODUCT_NAME . "» получена.\n"
        . "Формат: $format\nСумма: $total\n\n"
        . "Чтобы завершить регистрацию, откройте Telegram-бота по ссылке:\n$link\n\n"
        . "Кассовый чек банк пришлёт отдельным письмом.\n\n"
        . "Если остались вопросы, напишите нам: {$contacts['email']} или в Telegram @{$contacts['telegram']}";
    $notifyEmail = (string) config()['notify_email'];
    // mail() keeps no "Sent" copy, so a hidden copy shows the organizers what the customer got.
    if (!send_mail($order['email'], 'Оплата получена — ' . PRODUCT_NAME, $customerText, $notifyEmail)) {
        log_event("mail failed order={$order['id']} to={$order['email']}");
    }
    if ($notifyEmail) {
        // One line per purchased part with its price, as on the receipt.
        $lines = array_map(
            fn($item) => "— {$item['title']}: " . number_format($item['price'], 0, ',', ' ') . ' ₽',
            array_merge([$order['plan']], $order['electives'])
        );
        $ownerText = "Новая оплата\n\nЗаказ: {$order['id']}\nИмя: {$order['name']}\n"
            . "Email: {$order['email']}\nТелефон: {$order['phone']}\n"
            . "Telegram: @" . ($order['telegram'] ?? '') . "\n\n"
            . "Состав:\n" . implode("\n", $lines) . "\n"
            . (empty($order['promo']) ? '' : "Промокод {$order['promo']['code']}: скидка "
                . number_format($order['promo']['discount'], 0, ',', ' ') . " ₽ (уже в ценах выше)\n")
            . "Итого: $total\n\n"
            . "Операция Точки: {$order['operationId']}";
        // The fixed "Новая оплата" prefix lets a mailbox filter sort these into a folder.
        send_mail($notifyEmail, "Новая оплата: $total — {$order['name']}", $ownerText);
    }
}

/**
 * Decodes base64url.
 * @param string $value
 * @return string Raw bytes.
 */
function base64url_decode(string $value): string
{
    return (string) base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4));
}

/**
 * Encodes a DER length.
 * @param int $length
 * @return string
 */
function der_length(int $length): string
{
    if ($length < 0x80) {
        return chr($length);
    }
    $bytes = ltrim(pack('N', $length), "\0");
    return chr(0x80 | strlen($bytes)) . $bytes;
}

/**
 * Converts an RSA JWK (n, e) to a PEM public key for openssl_verify.
 * @param array{n: string, e: string} $jwk
 * @return string PEM SubjectPublicKeyInfo.
 */
function jwk_to_pem(array $jwk): string
{
    $integer = function (string $bytes): string {
        // A leading zero keeps the INTEGER positive when the high bit is set.
        if (ord($bytes[0]) > 0x7f) {
            $bytes = "\0" . $bytes;
        }
        return "\x02" . der_length(strlen($bytes)) . $bytes;
    };
    $sequence = fn(string $content) => "\x30" . der_length(strlen($content)) . $content;
    $rsaKey = $sequence($integer(base64url_decode($jwk['n'])) . $integer(base64url_decode($jwk['e'])));
    // AlgorithmIdentifier for rsaEncryption with NULL parameters.
    $algorithm = $sequence("\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00");
    $bitString = "\x03" . der_length(strlen($rsaKey) + 1) . "\0" . $rsaKey;
    $der = $sequence($algorithm . $bitString);
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n")
        . "-----END PUBLIC KEY-----\n";
}

/**
 * Where the webhook signing key is cached.
 * @return string
 */
function public_key_path(): string
{
    return private_dir() . '/tochka-public-key.pem';
}

/**
 * Tochka's webhook signing key, cached on disk.
 * @param bool $refresh Skip the cache, e.g. after the key was rotated.
 * @return string PEM public key.
 * @throws RuntimeException When the key cannot be fetched.
 */
function tochka_public_key(bool $refresh = false): string
{
    $cachePath = public_key_path();
    if (!$refresh && is_file($cachePath) && time() - filemtime($cachePath) < PUBLIC_KEY_CACHE_SECONDS) {
        return (string) file_get_contents($cachePath);
    }
    $curl = curl_init(TOCHKA_PUBLIC_KEY_URL);
    curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $jwk = json_decode((string) curl_exec($curl), true);
    if (empty($jwk['n']) || empty($jwk['e'])) {
        throw new RuntimeException('Cannot fetch Tochka public key');
    }
    $pem = jwk_to_pem($jwk);
    file_put_contents($cachePath, $pem, LOCK_EX);
    return $pem;
}

/**
 * Verifies a webhook JWT (RS256) and returns its payload.
 * @param string $token Raw request body.
 * @return array<string, mixed>|null Null when the signature or format is wrong.
 */
function verify_webhook(string $token): ?array
{
    $parts = explode('.', trim($token));
    if (count($parts) !== 3) {
        return null;
    }
    [$header, $payload, $signature] = $parts;
    $headerData = json_decode(base64url_decode($header), true);
    if (($headerData['alg'] ?? '') !== 'RS256') {
        return null;
    }
    $signed = $header . '.' . $payload;
    $signatureBytes = base64url_decode($signature);
    $valid = openssl_verify($signed, $signatureBytes, tochka_public_key(), OPENSSL_ALGO_SHA256) === 1;
    // The bank may have rotated the key since it was cached.
    if (!$valid && time() - (int) @filemtime(public_key_path()) > PUBLIC_KEY_REFRESH_SECONDS) {
        $valid = openssl_verify($signed, $signatureBytes, tochka_public_key(true), OPENSSL_ALGO_SHA256) === 1;
    }
    return $valid ? json_decode(base64url_decode($payload), true) : null;
}
