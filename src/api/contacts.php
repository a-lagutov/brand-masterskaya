<?php
/**
 * Contacts for the page: {"phone": "+79150446975", "phoneText": "+7 915 044-69-75",
 * "telegram": "brandmasterskaya", "email": "..."}.
 *
 * The pages ship with the default contacts and replace them with these, so a change in the
 * admin panel ("Настройки сайта") appears without a rebuild; see src/js/contacts.js.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

respond_json(200, site_contacts());
