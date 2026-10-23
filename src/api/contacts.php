<?php
/**
 * Contacts and legal details for the pages: {"contacts": {"phone": "+79150446975",
 * "phoneText": "+7 915 044-69-75", "telegram": "brandmasterskaya", "email": "..."},
 * "legal": {"inn": "...", "ownerName": "...", ...}}.
 *
 * The pages ship with the default values and replace them with these, so a change in the
 * admin panel ("Настройки сайта") appears without a rebuild; see src/js/contacts.js.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

respond_json(200, ['contacts' => site_contacts(), 'legal' => site_legal()]);
