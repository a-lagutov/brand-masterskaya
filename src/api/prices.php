<?php
/**
 * Current prices for the page: {"<key>": <rubles>, ..., "dolyame": <whether installments are on>}.
 *
 * The page shows the prices baked in by the build and replaces them with these, so a price
 * changed in the admin panel appears without a rebuild.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

$prices = [];
foreach ([...array_keys(PLANS), ...array_keys(ELECTIVES)] as $key) {
    $prices[$key] = PLANS[$key]['price'] ?? ELECTIVES[$key]['price'];
}
// The page shows the Dolyame button only when the server can create such orders.
$prices['dolyame'] = dolyame_enabled();
respond_json(200, $prices);
