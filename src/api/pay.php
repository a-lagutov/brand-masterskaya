<?php
/**
 * Creates an order and a payment link: a Tochka link with a receipt, or a Dolyame installment
 * application when method is "dolyame".
 *
 * POST JSON {name, email, phone, telegram, plan, electives: string[], promoCode?: string,
 *   method?: "dolyame"}
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
// Stored without @ or a t.me link, like the form sends it.
$telegram = preg_replace('~^(https?://)?(t\.me|telegram\.me)/|^@~i', '', trim((string) ($input['telegram'] ?? '')));
$planKey = (string) ($input['plan'] ?? '');
$electiveKeys = array_values(array_unique(array_map('strval', (array) ($input['electives'] ?? []))));
$useDolyame = ($input['method'] ?? '') === 'dolyame';
$promoCode = trim((string) ($input['promoCode'] ?? ''));

// Same rules as the form in src/js/app.js; the browser checks are only a convenience.
if ($name === '' || mb_strlen($name) > 100) {
    respond_json(422, ['error' => 'Укажите имя']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 160) {
    respond_json(422, ['error' => 'Укажите email в формате you@example.com']);
}
// International format: plus, country code and number, 8-15 digits in all (+7 takes exactly 11).
if (!preg_match('/^\+(7\d{10}|[1-9]\d{7,14})$/', $phone)) {
    respond_json(422, ['error' => 'Укажите телефон: выберите страну и введите номер полностью']);
}
if (!preg_match('/^[A-Za-z0-9_]{5,32}$/', $telegram)) {
    respond_json(422, ['error' => 'Укажите ник в Telegram, например @username']);
}
if (!isset(PLANS[$planKey])) {
    respond_json(422, ['error' => 'Выберите формат участия']);
}
foreach ($electiveKeys as $electiveKey) {
    if (!isset(ELECTIVES[$electiveKey]) || $planKey !== ELECTIVES_PLAN) {
        respond_json(422, ['error' => 'Факультатив доступен только в формате «' . PLANS[ELECTIVES_PLAN]['title'] . '»']);
    }
}

// The code is checked here again: the form only previews the discount.
$promo = $promoCode === '' ? null : find_promo_code($promoCode);
if ($promoCode !== '' && $promo === null) {
    respond_json(422, ['error' => 'Промокод не найден или больше не действует']);
}
if ($promo !== null && !array_intersect_key($promo['discounts'], array_flip([$planKey, ...$electiveKeys]))) {
    respond_json(422, ['error' => 'Промокод не действует на выбранный формат и факультативы']);
}

$config = config();
if ($useDolyame && !dolyame_enabled()) {
    respond_json(422, ['error' => 'Оплата частями сейчас недоступна']);
}
// Each discounted line carries its own lower price, so the receipt shows what was paid for it.
$withDiscount = function (array $item, string $key) use ($promo): array {
    $percent = $promo['discounts'][$key] ?? 0;
    return $percent ? [...$item, 'price' => $item['price'] - promo_discount($item['price'], $percent)] : $item;
};
$plan = $withDiscount(PLANS[$planKey], $planKey);
$electives = array_map(fn($key) => $withDiscount(ELECTIVES[$key], $key), $electiveKeys);
$fullTotal = PLANS[$planKey]['price'] + array_sum(array_map(fn($key) => ELECTIVES[$key]['price'], $electiveKeys));
$discount = $fullTotal - $plan['price'] - array_sum(array_map(fn($item) => $item['price'], $electives));
$total = $plan['price'] + array_sum(array_map(fn($item) => $item['price'], $electives));
$order = [
    'id' => bin2hex(random_bytes(16)),
    'createdAt' => date('c'),
    'name' => $name,
    'email' => $email,
    'phone' => $phone,
    'telegram' => $telegram,
    'plan' => $plan,
    'electives' => $electives,
    // Keys from src/prices.json; the bot (admin/) maps them to chats.
    'planKey' => $planKey,
    'electiveKeys' => $electiveKeys,
    'total' => $total,
    // The items above already hold the discounted prices; discount is their sum in rubles.
    'promo' => $promo === null ? null : [
        'code' => $promo['code'],
        'discounts' => $promo['discounts'],
        'discount' => $discount,
    ],
    'operationId' => null,
    'provider' => $useDolyame ? 'dolyame' : 'tochka',
    'paidAt' => null,
];

if ($useDolyame) {
    try {
        $response = dolyame_request('POST', '/orders/create', [
            'order' => ['id' => dolyame_order_id($order['id']), 'amount' => $total, 'items' => dolyame_items($order)],
            'client_info' => ['first_name' => $name, 'phone' => $phone, 'email' => $email],
            'notification_url' => $config['site_url'] . '/api/dolyame-webhook.php',
            'success_url' => $config['site_url'] . '/spasibo.html?order=' . $order['id'],
            'fail_url' => $config['site_url'] . '/?payment=failed#pricing',
            'fiscalization_settings' => ['type' => 'enabled'],
        ]);
    } catch (RuntimeException $exception) {
        log_event('dolyame create failed order=' . $order['id'] . ' ' . $exception->getMessage());
        respond_json(502, ['error' => 'Не удалось оформить рассрочку. Попробуйте ещё раз или оплатите картой.']);
    }
    save_order($order);
    log_event("created order={$order['id']} provider=dolyame total=$total promo=" . ($promo['code'] ?? '-'));
    respond_json(200, ['paymentLink' => (string) ($response['link'] ?? '')]);
}

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
log_event("created order={$order['id']} operation={$order['operationId']} total=$total promo=" . ($promo['code'] ?? '-'));
respond_json(200, ['paymentLink' => $paymentLink]);
