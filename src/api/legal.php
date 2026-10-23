<?php
/**
 * A legal document for its page: GET ?doc=oferta|privacy returns the HTML that goes inside
 * <main>, with the variables filled from the admin panel ("Настройки сайта"); see
 * src/js/contacts.js.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

$name = (string) ($_GET['doc'] ?? '');
if (!in_array($name, ['oferta', 'privacy'], true)) {
    respond_json(404, ['error' => 'Документ не найден']);
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
echo render_legal_document($name);
