<?php
/**
 * Shared code for the payment endpoints and the bot: catalog, config, order storage,
 * Tochka and Telegram API calls, webhook signature check and emails.
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

// Plans and prices from src/prices.json, copied next to this file by the build.
// Prices are checked here, not trusted from the browser.
define('PRICES', json_decode((string) file_get_contents(__DIR__ . '/prices.json'), true, 512, JSON_THROW_ON_ERROR));
const PLANS = PRICES['plans'];
const ELECTIVES = PRICES['electives'];
// Electives can only be added to this plan.
const ELECTIVES_PLAN = PRICES['electivesPlan'];
// Bot texts, program chats and which purchase opens which chat, from src/telegram.json.
define('TELEGRAM', json_decode((string) file_get_contents(__DIR__ . '/telegram.json'), true, 512, JSON_THROW_ON_ERROR));
const PRODUCT_NAME = 'Мастерская бренд-стратегии';
// Salebot link to the Telegram bot, used while no bot token is configured;
// the application travels in the query string.
const APPLICATION_LINK = 'https://link.brandmasterskaya.ru/r/zayavka_1';
const TOCHKA_PRODUCTION_URL = 'https://enter.tochka.com/uapi';
const TOCHKA_SANDBOX_URL = 'https://enter.tochka.com/sandbox/v2';
const TOCHKA_SANDBOX_TOKEN = 'sandbox.jwt.token';
const TOCHKA_PUBLIC_KEY_URL = 'https://enter.tochka.com/doc/openapi/static/keys/public';
// The webhook key rarely changes; refetch it once a day.
const PUBLIC_KEY_CACHE_SECONDS = 86400;
// After a failed check, refetch at most this often, so junk requests do not hammer the bank.
const PUBLIC_KEY_REFRESH_SECONDS = 300;
const ORDER_ID_PATTERN = '/^[a-f0-9]{32}$/';
const TELEGRAM_API_URL = 'https://api.telegram.org/bot';

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
            'payment_modes' => ['card', 'sbp'],
            'site_url' => 'https://brandmasterskaya.ru',
            'mail_from' => 'noreply@brandmasterskaya.ru',
            'notify_email' => '',
            'test_item_price' => null,
            'telegram_bot_token' => '',
            'telegram_bot_username' => 'masterskaya_brand_strategy_bot',
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
    if (config()['telegram_bot_token'] !== '') {
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
 * Calls the Telegram Bot API.
 * @param string $method E.g. sendMessage.
 * @param array<string, mixed> $parameters
 * @return mixed The "result" field of the response.
 * @throws RuntimeException On network errors and responses with ok=false.
 */
function telegram_request(string $method, array $parameters = []): mixed
{
    $curl = curl_init(TELEGRAM_API_URL . config()['telegram_bot_token'] . '/' . $method);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($parameters, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
    ]);
    $raw = curl_exec($curl);
    if ($raw === false) {
        throw new RuntimeException("Telegram $method: " . curl_error($curl));
    }
    $response = json_decode((string) $raw, true);
    if (empty($response['ok'])) {
        throw new RuntimeException("Telegram $method: " . ($response['description'] ?? $raw));
    }
    return $response['result'];
}

/**
 * Secret Telegram sends with every webhook call, derived from the token so it needs no
 * separate setting; scripts/telegram.mjs registers the same value.
 * @return string 64 hex characters.
 */
function telegram_webhook_secret(): string
{
    return hash_hmac('sha256', 'telegram-webhook', (string) config()['telegram_bot_token']);
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
    $customerText = "Здравствуйте, {$order['name']}!\n\n"
        . "Оплата участия в программе «" . PRODUCT_NAME . "» получена.\n"
        . "Формат: $format\nСумма: $total\n\n"
        . "Чтобы завершить регистрацию, откройте Telegram-бота по ссылке:\n$link\n\n"
        . "Кассовый чек банк пришлёт отдельным письмом.\n\n"
        . "Если остались вопросы, напишите нам: contact@brandmasterskaya.ru";
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
            . "Состав:\n" . implode("\n", $lines) . "\nИтого: $total\n\n"
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
