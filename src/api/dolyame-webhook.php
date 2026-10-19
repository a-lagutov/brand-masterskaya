<?php
/**
 * Receives Dolyame notifications (POST JSON {id, status, ...}).
 *
 * The body is not trusted: the sender must be on a Dolyame network, and the status is
 * re-read from the Dolyame API (dolyame_sync) before anything changes. Answers 200 "OK" for
 * every notification it understood, otherwise Dolyame retries.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond_json(405, ['error' => 'Method not allowed']);
}

$remoteAddress = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
$allowed = array_filter(DOLYAME_WEBHOOK_NETWORKS, fn($network) => ip_in_network($remoteAddress, $network));
if (!$allowed) {
    log_event("dolyame webhook rejected: ip=$remoteAddress");
    respond_json(403, ['error' => 'Forbidden']);
}

$event = json_decode((string) file_get_contents('php://input'), true);
$orderId = is_array($event) ? order_id_from_dolyame_id((string) ($event['id'] ?? '')) : null;
log_event('dolyame webhook status=' . ($event['status'] ?? '') . ' order=' . ($orderId ?? 'unknown'));

// Unknown ids (test notifications, other shops) are acknowledged and ignored.
if (dolyame_configured() && $orderId !== null) {
    $status = dolyame_sync($orderId);
    if ($status === '') {
        // The status could not be checked; a non-200 makes Dolyame retry later.
        respond_json(503, ['error' => 'Try later']);
    }
}
header('Content-Type: text/plain; charset=utf-8');
echo 'OK';
