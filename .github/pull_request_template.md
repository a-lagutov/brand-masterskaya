## What and why

<!-- What changes for a site visitor, a buyer, an organizer in the admin panel or in the bot. -->

## Affected

- [ ] Site (`src/`, `scripts/build.mjs`)
- [ ] Payment (`src/api/`)
- [ ] Admin panel and bot (`admin/`)
- [ ] Admin database schema (new migration in `admin/src/migrations/`)
- [ ] Telegram relay (`worker/`)
- [ ] Deploy, secrets, GitHub variables (`.github/workflows/`)

## Checked on test

<!-- The branch is already deployed to test.brandmasterskaya.ru and admin.test.brandmasterskaya.ru. -->

- [ ] Page and form on test.brandmasterskaya.ru, including on a phone
- [ ] Payment goes through, the order confirmation page leads to the bot
- [ ] @masterskaya_brand_test_bot answers `/start` and lets the buyer into the chats
- [ ] Changes show up in admin.test.brandmasterskaya.ru

## After merge to main

<!-- Merging deploys brandmasterskaya.ru, admin.brandmasterskaya.ru and the live bot. -->

- [ ] Nothing to do by hand
- [ ] By hand: <!-- a secret, a setting in the reg.ru panel, a text in the admin panel… -->
