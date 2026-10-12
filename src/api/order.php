<?php
/**
 * Order status for the thank-you page.
 *
 * GET ?id=<order id>
 * 200 {status: "paid", telegramLink, email} | {status: "pending"} | {status: "expired"}
 * 404 {status: "not_found"}
 *
 * If the webhook has not arrived yet, asks Tochka directly, so the page does not
 * depend on webhook delivery. The 128-bit order id is the only access token.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

$orderId = (string) ($_GET['id'] ?? '');
$order = load_order($orderId);
if ($order === null) {
    respond_json(404, ['status' => 'not_found']);
}

if (empty($order['paidAt']) && $order['operationId']) {
    try {
        $response = tochka_request('GET', '/acquiring/v1.0/payments/' . rawurlencode($order['operationId']));
        $operation = $response['Data']['Operation'][0] ?? [];
        $bankStatus = $operation['status'] ?? '';
        if ($bankStatus === 'APPROVED') {
            $order = mark_paid($orderId, (string) ($operation['paymentType'] ?? ''));
        } elseif ($bankStatus === 'EXPIRED') {
            respond_json(200, ['status' => 'expired']);
        }
    } catch (RuntimeException $exception) {
        // The page polls again; report pending instead of an error.
        log_event("status check failed order=$orderId " . $exception->getMessage());
    }
}

if (empty($order['paidAt'])) {
    respond_json(200, ['status' => 'pending']);
}
respond_json(200, [
    'status' => 'paid',
    'telegramLink' => telegram_link($order),
    'email' => $order['email'],
]);
