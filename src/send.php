<?php

/**
 * Receives an application from the landing form and forwards it to the Salebot webhook.
 *
 * Request (JSON, same-origin POST):
 *   { name, contact, plan: { title, price }, electives: [{ title, price }], total, currency }
 *
 * Prices are never trusted: titles are looked up in the catalog below and
 * prices and total are recomputed before forwarding.
 *
 * The webhook URL lives outside the site directory, so deploys never touch it:
 *   ~/config/application.php  →  <?php return ['webhook_url' => 'https://...'];
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
 * Validates the request body and rebuilds the application from the catalog.
 *
 * @param array $input Decoded request JSON.
 * @return array|null Application to forward, or null when the input is invalid.
 */
function buildApplication(array $input): ?array
{
    $name = cleanText($input['name'] ?? null, NAME_MAX_LENGTH);
    $contact = cleanText($input['contact'] ?? null, CONTACT_MAX_LENGTH);
    $planTitle = $input['plan']['title'] ?? null;
    $electiveItems = $input['electives'] ?? [];
    if ($name === null || $contact === null || !is_string($planTitle) || !isset(PLANS[$planTitle])) {
        return null;
    }
    if (!is_array($electiveItems) || ($electiveItems && $planTitle !== PLAN_WITH_ELECTIVES)) {
        return null;
    }

    $electives = [];
    foreach ($electiveItems as $item) {
        $title = is_array($item) ? ($item['title'] ?? null) : null;
        if (!is_string($title) || !isset(ELECTIVES[$title]) || isset($electives[$title])) {
            return null;
        }
        $electives[$title] = ['title' => $title, 'price' => ELECTIVES[$title]];
    }

    $planPrice = PLANS[$planTitle];
    return [
        'name' => $name,
        'contact' => $contact,
        'plan' => ['title' => $planTitle, 'price' => $planPrice],
        'electives' => array_values($electives),
        'total' => $planPrice + array_sum(array_column($electives, 'price')),
        'currency' => CURRENCY,
    ];
}

/**
 * Posts the application to the webhook.
 *
 * @param string $webhookUrl Target URL from the server config.
 * @param array $application Validated application.
 * @return bool True when the webhook answered with 2xx.
 */
function forwardToWebhook(string $webhookUrl, array $application): bool
{
    $curl = curl_init($webhookUrl);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($application, JSON_UNESCAPED_UNICODE),
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

$input = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($input)) {
    respond(400, ['ok' => false, 'error' => 'invalid_json']);
}

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
$webhookUrl = is_array($config) ? ($config['webhook_url'] ?? '') : '';
if (!is_string($webhookUrl) || !str_starts_with($webhookUrl, 'https://')) {
    error_log('application webhook is not configured: ' . CONFIG_PATH);
    respond(503, ['ok' => false, 'error' => 'not_configured']);
}

if (!forwardToWebhook($webhookUrl, $application)) {
    respond(502, ['ok' => false, 'error' => 'delivery_failed']);
}

respond(200, ['ok' => true]);
