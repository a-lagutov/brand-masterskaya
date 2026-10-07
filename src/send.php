<?php

/**
 * Receives an application from the landing form and forwards it to the Salebot API.
 *
 * Request (flat form POST):
 *   name, contact, telegram, plan, electives
 * `contact` is an email or a phone, `telegram` is optional,
 * `electives` is a comma-separated list of titles.
 *
 * Delivery to Salebot takes two calls:
 *   1. load_clients creates the client: platform_id is the phone digits or the
 *      email, client_type and group_id come from the server config;
 *   2. callback with the returned client_id, a fixed `message` that triggers
 *      the bot block and the application fields (plan_price, electives_price,
 *      total, currency, `email` or `phone`), which Salebot saves as variables.
 * If load_clients returns no id, callback still finds the client by email or phone.
 *
 * Prices are never trusted: titles are looked up in the catalog below and
 * prices and total are recomputed before forwarding.
 *
 * #{api_key} in the Salebot URLs is replaced with the key from the server config,
 * which lives outside the site directory so deploys never touch it:
 *   ~/config/application.php  →  <?php return [
 *       'api_key' => '...',
 *       'client_type' => 13,  // optional, Salebot messenger type, 13 = telephony
 *       'group_id' => '',     // optional, from /api/<api_key>/connected_channels
 *   ];
 */

declare(strict_types=1);

const PLANS = [
    'Только смотрю' => 89900,
    'Смотрю и работаю' => 219900,
];
const ELECTIVES = [
    'Продвинутый бренд-директор' => 69900,
    'Бренд-ориентированный бизнес' => 69900,
];
// Only the full plan can include electives.
const PLAN_WITH_ELECTIVES = 'Смотрю и работаю';
const CURRENCY = 'RUB';
const NAME_MAX_LENGTH = 100;
const CONTACT_MAX_LENGTH = 160;
const TELEGRAM_MAX_LENGTH = 64;
// International numbers have 10 to 15 digits.
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
// Requests per IP within the window before the endpoint starts refusing.
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const WEBHOOK_TIMEOUT_SECONDS = 10;
const SALEBOT_LOAD_CLIENTS_URL = 'https://chatter.salebot.pro/api/#{api_key}/load_clients';
const SALEBOT_CALLBACK_URL = 'https://chatter.salebot.pro/api/#{api_key}/callback';
// Telephony needs no group; other channels need group_id in the config.
const DEFAULT_CLIENT_TYPE = 13;
const DEFAULT_GROUP_ID = '';
const ELECTIVES_SEPARATOR = ', ';
// Fixed callback text: the bot's block is triggered by it; details travel in variables.
const CALLBACK_MESSAGE = 'zayavka';

$homeDir = dirname(__DIR__, 2);
define('CONFIG_PATH', $homeDir . '/config/application.php');
define('RATE_LIMIT_DIR', $homeDir . '/tmp/application-rate-limit');

/**
 * Sends a JSON response and stops the script.
 *
 * @param int $status HTTP status code.
 * @param array $body Response payload.
 */
function respond(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Trims a string field and checks its length.
 *
 * @param mixed $value Raw value from the request.
 * @param int $maxLength Maximum length in characters.
 * @return string|null Clean value, or null when missing or too long.
 */
function cleanText(mixed $value, int $maxLength): ?string
{
    if (!is_string($value)) {
        return null;
    }
    $text = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    $length = mb_strlen($text);
    return $length > 0 && $length <= $maxLength ? $text : null;
}

/**
 * Detects whether the contact is an email or a phone.
 *
 * @param string $contact Cleaned contact field.
 * @return array|null ['email' => ...] or ['phone' => ...], or null when it is neither.
 */
function parseContact(string $contact): ?array
{
    if (filter_var($contact, FILTER_VALIDATE_EMAIL)) {
        return ['email' => $contact];
    }
    if (!preg_match('/^\+?[\d\s()\-]+$/', $contact)) {
        return null;
    }
    $digits = preg_replace('/\D/', '', $contact);
    // Russian numbers are often typed with a leading 8 instead of +7.
    if (strlen($digits) === 11 && $digits[0] === '8') {
        $digits = '7' . substr($digits, 1);
    }
    $length = strlen($digits);
    return $length >= PHONE_MIN_DIGITS && $length <= PHONE_MAX_DIGITS ? ['phone' => '+' . $digits] : null;
}

/**
 * Counts this IP's recent requests and records the current one.
 *
 * @param string $clientIp Client address.
 * @return bool True when the client is over the limit.
 */
function isRateLimited(string $clientIp): bool
{
    if (!is_dir(RATE_LIMIT_DIR) && !mkdir(RATE_LIMIT_DIR, 0700, true)) {
        return false;
    }
    // Hash the IP so the directory holds no raw addresses.
    $logPath = RATE_LIMIT_DIR . '/' . hash('sha256', $clientIp);
    $now = time();
    $recentRequests = [];
    if (is_file($logPath)) {
        foreach (file($logPath, FILE_IGNORE_NEW_LINES) ?: [] as $timestamp) {
            if ($now - (int) $timestamp < RATE_LIMIT_WINDOW_SECONDS) {
                $recentRequests[] = (int) $timestamp;
            }
        }
    }
    $recentRequests[] = $now;
    file_put_contents($logPath, implode("\n", $recentRequests), LOCK_EX);
    return count($recentRequests) > RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Validates the form fields and rebuilds the application from the catalog.
 *
 * @param array $input Posted form fields.
 * @return array|null Flat application to forward, or null when the input is invalid.
 */
function buildApplication(array $input): ?array
{
    $name = cleanText($input['name'] ?? null, NAME_MAX_LENGTH);
    $contact = cleanText($input['contact'] ?? null, CONTACT_MAX_LENGTH);
    $contactFields = $contact === null ? null : parseContact($contact);
    $telegramField = $input['telegram'] ?? '';
    $telegram = $telegramField === '' ? '' : cleanText($telegramField, TELEGRAM_MAX_LENGTH);
    $planTitle = $input['plan'] ?? null;
    $electivesField = $input['electives'] ?? '';
    if ($contactFields === null || $telegram === null) {
        return null;
    }
    if ($name === null || !is_string($planTitle) || !isset(PLANS[$planTitle])) {
        return null;
    }
    if (!is_string($electivesField)) {
        return null;
    }
    $electiveTitles = $electivesField === '' ? [] : explode(ELECTIVES_SEPARATOR, $electivesField);
    if ($electiveTitles && $planTitle !== PLAN_WITH_ELECTIVES) {
        return null;
    }
    foreach ($electiveTitles as $title) {
        if (!isset(ELECTIVES[$title])) {
            return null;
        }
    }
    if (count(array_unique($electiveTitles)) !== count($electiveTitles)) {
        return null;
    }

    $planPrice = PLANS[$planTitle];
    $electivesPrice = array_sum(array_map(fn(string $title) => ELECTIVES[$title], $electiveTitles));
    $application = [
        'name' => $name,
        'contact' => $contact,
        'telegram' => $telegram,
        'plan' => $planTitle,
        'plan_price' => $planPrice,
        'electives' => implode(ELECTIVES_SEPARATOR, $electiveTitles),
        'electives_price' => $electivesPrice,
        'total' => $planPrice + $electivesPrice,
        'currency' => CURRENCY,
    ];
    return $application + $contactFields + ['message' => CALLBACK_MESSAGE];
}

/**
 * Sends one POST request to Salebot.
 *
 * @param string $url Salebot URL with the key filled in.
 * @param string $body Encoded request body.
 * @param string $contentType Content-Type of the body.
 * @return array|null Decoded JSON answer (empty when not JSON), or null on a non-2xx status.
 */
function postToSalebot(string $url, string $body, string $contentType): ?array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => ["Content-Type: $contentType"],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => WEBHOOK_TIMEOUT_SECONDS,
    ]);
    $responseBody = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    // The key is part of the path, so log only the method name.
    $method = basename((string) parse_url($url, PHP_URL_PATH));
    if ($status < 200 || $status >= 300) {
        // Salebot explains failures in the body, e.g. a missing required parameter.
        $reason = is_string($responseBody) ? mb_substr($responseBody, 0, 200) : '';
        error_log("salebot $method failed: status=$status error=$error body=$reason");
        return null;
    }
    $decoded = is_string($responseBody) ? json_decode($responseBody, true) : null;
    return is_array($decoded) ? $decoded : [];
}

/**
 * Creates the client in Salebot via load_clients.
 *
 * @param string $apiKey Salebot API key.
 * @param array $client ['platform_id' => ..., 'group_id' => ..., 'client_type' => ...].
 * @return int|null Salebot client_id, or null when Salebot did not return one.
 */
function loadClient(string $apiKey, array $client): ?int
{
    $url = str_replace('#{api_key}', $apiKey, SALEBOT_LOAD_CLIENTS_URL);
    $answer = postToSalebot($url, json_encode([$client], JSON_UNESCAPED_UNICODE), 'application/json');
    // Success looks like {"status":"success","items":[{..., "status":"success", "id":1469409}]}.
    $item = $answer['items'][0] ?? null;
    if (!is_array($item) || !isset($item['id']) || !is_numeric($item['id'])) {
        $reason = mb_substr((string) json_encode($answer, JSON_UNESCAPED_UNICODE), 0, 200);
        error_log("salebot load_clients returned no id: $reason");
        return null;
    }
    return (int) $item['id'];
}

/**
 * Triggers the bot for the client and saves the application as variables.
 *
 * @param string $apiKey Salebot API key.
 * @param array $application Validated application.
 * @param int|null $clientId Salebot client_id; without it Salebot looks up the client by email or phone.
 * @return bool True when Salebot answered with 2xx.
 */
function sendCallback(string $apiKey, array $application, ?int $clientId): bool
{
    $url = str_replace('#{api_key}', $apiKey, SALEBOT_CALLBACK_URL);
    $fields = $clientId === null ? $application : ['client_id' => $clientId] + $application;
    return postToSalebot($url, http_build_query($fields), 'application/x-www-form-urlencoded') !== null;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// Browsers always send Origin on POST; refuse requests from other sites.
// Comparing with Host keeps local preview working too.
$origin = $_SERVER['HTTP_ORIGIN'] ?? null;
if ($origin !== null && parse_url($origin, PHP_URL_HOST) !== strtok($_SERVER['HTTP_HOST'] ?? '', ':')) {
    respond(403, ['ok' => false, 'error' => 'forbidden']);
}

$input = $_POST;

// Honeypot: humans never see this field, bots fill it. Pretend success.
if (!empty($input['website'])) {
    respond(200, ['ok' => true]);
}

if (isRateLimited($_SERVER['REMOTE_ADDR'] ?? 'unknown')) {
    respond(429, ['ok' => false, 'error' => 'too_many_requests']);
}

$application = buildApplication($input);
if ($application === null) {
    respond(422, ['ok' => false, 'error' => 'invalid_application']);
}

$config = is_file(CONFIG_PATH) ? require CONFIG_PATH : [];
$apiKey = is_array($config) ? ($config['api_key'] ?? '') : '';
if (!is_string($apiKey) || !preg_match('/^[A-Za-z0-9]+$/', $apiKey)) {
    error_log('salebot api_key is not configured: ' . CONFIG_PATH);
    respond(503, ['ok' => false, 'error' => 'not_configured']);
}
$clientType = $config['client_type'] ?? DEFAULT_CLIENT_TYPE;
$groupId = $config['group_id'] ?? DEFAULT_GROUP_ID;
// load_clients expects the phone as bare digits, e.g. 79875555555.
$platformId = isset($application['phone']) ? ltrim($application['phone'], '+') : $application['email'];

$clientId = loadClient($apiKey, [
    'platform_id' => $platformId,
    'group_id' => $groupId,
    'client_type' => $clientType,
]);
if (!sendCallback($apiKey, $application, $clientId)) {
    respond(502, ['ok' => false, 'error' => 'delivery_failed']);
}

respond(200, ['ok' => true]);
