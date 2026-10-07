<?php

/**
 * Receives an application from the landing form and forwards it to Salebot tg_callback.
 *
 * Request and forwarded body are the same flat form POST:
 *   name, contact, plan, plan_price, electives, electives_price, total, currency
 * `electives` is a comma-separated list of titles.
 *
 * Prices are never trusted: titles are looked up in the catalog below and
 * prices and total are recomputed before forwarding.
 *
 * #{api_key} in SALEBOT_URL is replaced with the key from the server config,
 * which lives outside the site directory so deploys never touch it:
 *   ~/config/application.php  →  <?php return ['api_key' => '...'];
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
const ALLOWED_ORIGINS = ['https://brandmasterskaya.ru', 'https://www.brandmasterskaya.ru'];
// Requests per IP within the window before the endpoint starts refusing.
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const WEBHOOK_TIMEOUT_SECONDS = 10;
const SALEBOT_URL = 'https://chatter.salebot.pro/api/#{api_key}/tg_callback';
const ELECTIVES_SEPARATOR = ', ';

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
    $planTitle = $input['plan'] ?? null;
    $electivesField = $input['electives'] ?? '';
    if ($name === null || $contact === null || !is_string($planTitle) || !isset(PLANS[$planTitle])) {
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
    return [
        'name' => $name,
        'contact' => $contact,
        'plan' => $planTitle,
        'plan_price' => $planPrice,
        'electives' => implode(ELECTIVES_SEPARATOR, $electiveTitles),
        'electives_price' => $electivesPrice,
        'total' => $planPrice + $electivesPrice,
        'currency' => CURRENCY,
    ];
}

/**
 * Posts the application to Salebot as a flat form.
 *
 * @param string $webhookUrl Salebot URL with the key filled in.
 * @param array $application Validated application.
 * @return bool True when Salebot answered with 2xx.
 */
function forwardToWebhook(string $webhookUrl, array $application): bool
{
    $curl = curl_init($webhookUrl);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($application),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => WEBHOOK_TIMEOUT_SECONDS,
    ]);
    curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if ($status < 200 || $status >= 300) {
        error_log("application webhook failed: status=$status error=$error");
        return false;
    }
    return true;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'method_not_allowed']);
}

// Browsers always send Origin on POST; refuse requests from other sites.
$origin = $_SERVER['HTTP_ORIGIN'] ?? null;
if ($origin !== null && !in_array($origin, ALLOWED_ORIGINS, true)) {
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
$webhookUrl = str_replace('#{api_key}', $apiKey, SALEBOT_URL);

if (!forwardToWebhook($webhookUrl, $application)) {
    respond(502, ['ok' => false, 'error' => 'delivery_failed']);
}

respond(200, ['ok' => true]);
