<?php
/**
 * Current prices for the page: {"<key>": <rubles>, ...}.
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
respond_json(200, $prices);
