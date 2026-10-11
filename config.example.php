<?php
/**
 * Payment settings. Copy to ~/brandmasterskaya-private/config.php on the hosting
 * (next to www/, not inside it) and fill in. Never commit the real file.
 */

return [
    // true — Tochka sandbox with test data, no real money.
    'sandbox' => false,
    // JWT key from the Tochka internet bank: Сервисы → Интеграции и API → JWT-ключи.
    // Permissions: MakeAcquiringOperation, ReadAcquiringData, ReadCustomerData, ManageWebhookData.
    'tochka_jwt' => '',
    // 9 characters; `node scripts/tochka.mjs customers`, the entry with customerType Business.
    'customer_code' => '',
    // 15 digits; `node scripts/tochka.mjs retailers`. Needed when there are several retail points.
    'merchant_id' => '',
    // Receipt settings (54-FZ), agreed with the client: USN income, full payment.
    // osn | usn_income | usn_income_outcome | esn | patent
    'tax_system_code' => 'usn_income',
    // none | vat0 | vat5 | vat7 | vat10 | vat22 | …
    'vat_type' => 'none',
    // full_payment | full_prepayment
    'payment_method' => 'full_payment',
    // sbp | card | tinkoff | dolyame — only the ones enabled for the retail point.
    'payment_modes' => ['card', 'sbp'],
    'site_url' => 'https://brandmasterskaya.ru',
    // Sender of the "payment received" email; a mailbox on the site's domain.
    'mail_from' => 'noreply@brandmasterskaya.ru',
    // Where to send a copy of every paid order; empty to skip.
    'notify_email' => 'contact@brandmasterskaya.ru',
];
