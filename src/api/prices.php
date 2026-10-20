<?php
/**
 * Current prices for the page: {"<key>": <rubles>, ..., "dolyame": <whether the installments button is shown>}.
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
// The page shows the Dolyame button only when the server can create such orders and the admin
// panel has not hidden it.
$prices['dolyame'] = dolyame_button_visible();
respond_json(200, $prices);
