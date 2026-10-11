<?php
/**
 * Creates an order and a Tochka payment link with a receipt.
 *
 * POST JSON {name, email, phone, plan, electives: string[]}
 * 200 {paymentLink} — the browser goes there to pay.
 * 4xx/5xx {error} — a message to show in the form.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond_json(405, ['error' => 'Method not allowed']);
}

$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) {
    respond_json(400, ['error' => 'Некорректный запрос']);
}

$name = trim((string) ($input['name'] ?? ''));
$email = trim((string) ($input['email'] ?? ''));
$phone = (string) ($input['phone'] ?? '');
$planKey = (string) ($input['plan'] ?? '');
$electiveKeys = array_values(array_unique(array_map('strval', (array) ($input['electives'] ?? []))));

// Same rules as the form in src/js/app.js; the browser checks are only a convenience.
if ($name === '' || mb_strlen($name) > 100) {
    respond_json(422, ['error' => 'Укажите имя']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 160) {
    respond_json(422, ['error' => 'Укажите email в формате you@example.com']);
}
if (!preg_match('/^\+7\d{10}$/', $phone)) {
    respond_json(422, ['error' => 'Укажите телефон в формате +7 (900) 000-00-00']);
}
if (!isset(PLANS[$planKey])) {
    respond_json(422, ['error' => 'Выберите формат участия']);
}
foreach ($electiveKeys as $electiveKey) {
    if (!isset(ELECTIVES[$electiveKey]) || $planKey !== ELECTIVES_PLAN) {
        respond_json(422, ['error' => 'Факультатив доступен только в формате «' . PLANS[ELECTIVES_PLAN]['title'] . '»']);
    }
}

$plan = PLANS[$planKey];
$electives = array_map(fn($key) => ELECTIVES[$key], $electiveKeys);
$total = $plan['price'] + array_sum(array_map(fn($item) => $item['price'], $electives));
$order = [
    'id' => bin2hex(random_bytes(16)),
    'createdAt' => date('c'),
    'name' => $name,
    'email' => $email,
    'phone' => $phone,
    'plan' => $plan,
    'electives' => $electives,
    'total' => $total,
    'operationId' => null,
    'paidAt' => null,
];

$config = config();
// One receipt line per purchased part, so the receipt mirrors the order.
$receiptItems = array_map(fn($item) => [
    'name' => PRODUCT_NAME . ': ' . $item['title'],
    'amount' => $item['price'],
    'quantity' => 1,
    'vatType' => $config['vat_type'],
    'paymentMethod' => $config['payment_method'],
    'paymentObject' => 'service',
], array_merge([$plan], $electives));

$payment = [
    'customerCode' => $config['customer_code'],
    'amount' => $total,
    'purpose' => 'Участие в программе «' . PRODUCT_NAME . '», формат «' . $plan['title'] . '»',
    'paymentMode' => $config['payment_modes'],
    'paymentLinkId' => $order['id'],
    'redirectUrl' => $config['site_url'] . '/spasibo.html?order=' . $order['id'],
    'failRedirectUrl' => $config['site_url'] . '/?payment=failed#pricing',
    'taxSystemCode' => $config['tax_system_code'],
    'Client' => ['name' => $name, 'email' => $email, 'phone' => $phone],
    'Items' => $receiptItems,
];
if ($config['merchant_id']) {
    $payment['merchantId'] = $config['merchant_id'];
}

try {
    $response = tochka_request('POST', '/acquiring/v1.0/payments_with_receipt', ['Data' => $payment]);
} catch (RuntimeException $exception) {
    log_event('create failed order=' . $order['id'] . ' ' . $exception->getMessage());
    respond_json(502, ['error' => 'Не удалось создать платёж. Попробуйте ещё раз или напишите нам.']);
}

$order['operationId'] = $response['Data']['operationId'] ?? null;
$paymentLink = $response['Data']['paymentLink'] ?? '';
save_order($order);
log_event("created order={$order['id']} operation={$order['operationId']} total=$total");
respond_json(200, ['paymentLink' => $paymentLink]);
