<?php
/**
 * Payment settings, ~/private/<site folder>/config.php on the hosting, e.g.
 * ~/private/brandmasterskaya.ru/config.php. The deploy workflow writes it from repository
 * secrets; this file documents the keys. Never commit the real file.
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
    'notify_email' => 'noreply@brandmasterskaya.ru',
    // Test site only: charge this many rubles per receipt line instead of the real price.
    'test_item_price' => null,
    // The bot's @username without @, for the t.me link (admin/ runs the bot); the test site has
    // masterskaya_brand_test_bot. Empty — the site sends buyers to Salebot instead.
    'telegram_bot_username' => 'masterskaya_brand_strategy_bot',
];
