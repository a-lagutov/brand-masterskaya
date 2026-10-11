<?php
/**
 * Receives Tochka webhooks. The body is a JWT signed by the bank (RS256).
 *
 * On acquiringInternetPayment with status APPROVED the order is marked paid and the
 * customer gets the Telegram link by email. Always answers 200 to a correctly signed
 * webhook, otherwise the bank retries it 30 times.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond_json(405, ['error' => 'Method not allowed']);
}

try {
    $event = verify_webhook((string) file_get_contents('php://input'));
} catch (RuntimeException $exception) {
    // Without the key we cannot check anything; a non-200 makes the bank retry later.
    log_event('webhook key error ' . $exception->getMessage());
    respond_json(503, ['error' => 'Try later']);
}
if ($event === null) {
    log_event('webhook rejected: bad signature');
    respond_json(401, ['error' => 'Bad signature']);
}

$type = (string) ($event['webhookType'] ?? '');
$status = (string) ($event['status'] ?? '');
$orderId = (string) ($event['paymentLinkId'] ?? '');
log_event("webhook type=$type status=$status order=$orderId operation=" . ($event['operationId'] ?? ''));

if ($type !== 'acquiringInternetPayment' || $status !== 'APPROVED') {
    respond_json(200, ['ok' => true]);
}
$order = load_order($orderId);
// Test webhooks and payments made through other links carry unknown ids.
if ($order === null || ($event['customerCode'] ?? '') !== config()['customer_code']) {
    respond_json(200, ['ok' => true]);
}
if ((float) ($event['amount'] ?? 0) < $order['total']) {
    log_event("webhook amount mismatch order=$orderId amount=" . ($event['amount'] ?? ''));
    respond_json(200, ['ok' => true]);
}
mark_paid($orderId, (string) ($event['paymentType'] ?? ''));
respond_json(200, ['ok' => true]);
