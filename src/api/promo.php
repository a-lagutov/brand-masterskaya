<?php
/**
 * Checks a promo code for the form, so it can show the discount before payment.
 *
 * GET ?code=<code>
 * 200 {code, percent, plans: string[]} — plan keys the discount applies to.
 * 404 {error} — unknown or expired code.
 *
 * pay.php checks the code again and computes the price itself.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    respond_json(405, ['error' => 'Method not allowed']);
}

$promo = find_promo_code((string) ($_GET['code'] ?? ''));
if ($promo === null) {
    // Every miss costs a moment, so guessing codes one by one is slow.
    usleep(300000);
    respond_json(404, ['error' => 'Промокод не найден или больше не действует']);
}
respond_json(200, $promo);
