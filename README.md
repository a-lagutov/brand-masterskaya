# Мастерская бренд-стратегии

Лендинг авторской программы Антона Аверьянова и Михаила Чернышева.

Сайт: https://brandmasterskaya.ru

## Структура

```
src/                исходники сайта
  index.html        лендинг
  prices.json       тарифы, факультативы и цены по умолчанию (цены меняются в админке)
  oferta.html       договор-оферта
  privacy.html      политика обработки персональных данных и согласие
  spasibo.html      страница после оплаты
  api/              PHP: создание платежа, проверка промокода, вебхук Точки, статус заказа
  css/style.css
  js/app.js         лендинг и форма заявки
  js/thanks.js      страница после оплаты
  assets/images/    фотографии (без уменьшения) и og.jpg — превью ссылки в соцсетях
  assets/logos/     логотипы (уменьшаются до 480 px)
scripts/build.mjs   сборка src/ → dist/
scripts/og-image.*  шаблон и рендер превью для соцсетей → src/assets/images/og.jpg
scripts/tochka.mjs  настройка Точки: customerCode, merchantId, вебхук
admin/              админка Payload и Telegram-бот (Node.js), см. admin/README.md
worker/             Cloudflare Worker — посредник между ботом и api.telegram.org
config.example.php  образец настроек оплаты
.github/workflows/  CI и деплой
.husky/             git-хуки
```

## Требования

Node.js 22 и npm.

## Команды

```bash
npm install         # зависимости и git-хуки
npm run build       # сборка в dist/
npm run check       # линтеры и проверка форматирования
npm run format      # отформатировать всё через Prettier
npm run og-image    # перерисовать превью для соцсетей (нужен Google Chrome)
```

Посмотреть сборку локально:

```bash
python3 -m http.server 4173 -d dist
```

## Сборка

`scripts/build.mjs` собирает `src/` в `dist/`:

- страницы перечислены в `PAGES`; CSS и JS минифицируются через esbuild и встраиваются в каждую;
- HTML минифицируется;
- PNG и JPEG конвертируются в WebP, логотипы уменьшаются до 480 px по ширине;
- картинка из `og:image` копируется без конвертации (не все соцсети читают WebP), ссылка на неё становится абсолютной `https://brandmasterskaya.ru/…`;
- в `dist/` попадают только файлы, на которые ссылаются страницы, и PHP из `src/api/`.

## Оплата

Оплата идёт через интернет-эквайринг банка Точка ([API](https://developers.tochka.com/docs/tochka-api/opisanie-metodov/platyozhnye-ssylki)): платёжная ссылка с чеком по 54-ФЗ, карта и СБП.

1. Форма на сайте отправляет `POST api/pay.php` с именем, email, телефоном, ключом тарифа и факультативов и промокодом, если он введён.
2. `pay.php` проверяет данные, считает сумму по своим ценам, сохраняет заказ и создаёт платёжную ссылку (`/acquiring/v1.0/payments_with_receipt`). Номер заказа передаётся в Точку как `paymentLinkId`.
3. Браузер уходит на страницу оплаты банка. При неудаче банк возвращает на `/?payment=failed#pricing`, форма открывается с сообщением.
4. После оплаты банк возвращает на `spasibo.html?order=…`. Страница опрашивает `api/order.php`, пока заказ не оплачен, и показывает кнопку перехода в Telegram-бота.
5. Банк присылает вебхук `acquiringInternetPayment` на `api/webhook.php` (JWT, подпись RS256 проверяется по [ключу Точки](https://enter.tochka.com/doc/openapi/static/keys/public)). Заказ помечается оплаченным, клиенту уходит письмо со ссылкой на бота, организаторам — копия. Если вебхук задержался, то же самое делает `order.php`, сверив статус платежа в API. Письмо отправляется один раз.

Ссылка на бота — `https://t.me/masterskaya_brand_strategy_bot?start=<номер заказа>`, дальше работает [Telegram-бот](#telegram-бот). Пока имя бота не задано (`telegram_bot_username`), сайт ведёт на Salebot с заявкой в параметрах:

```
https://link.brandmasterskaya.ru/r/zayavka_1?name=…&email=…&phone=…&plan=…&plan_price=…&electives=…&electives_price=…&total=…&currency=RUB&order=…
```

| Параметр          | Пример                                                   |
| ----------------- | -------------------------------------------------------- |
| `name`            | Иван Петров                                              |
| `email`           | ivan@example.com                                         |
| `phone`           | +79001234567                                             |
| `plan`            | Смотрю и работаю                                         |
| `plan_price`      | 219900                                                   |
| `electives`       | Продвинутый бренд-директор, Бренд-ориентированный бизнес |
| `electives_price` | 139800                                                   |
| `total`           | 359700                                                   |
| `currency`        | RUB                                                      |
| `order`           | 32 hex-символа, номер заказа и `paymentLinkId` в Точке   |

Email и телефон обязательны и проверяются в браузере и на сервере. Принимаются только российские номера: поле начинается с `+7`, номер форматируется при вводе как `+7 (900) 123-45-67`, ведущая 8 заменяется на +7, другие коды стран отклоняются. На сервер телефон уходит как `+79001234567`.

Тарифы, факультативы и цены заданы в одном файле — [src/prices.json](src/prices.json). Сборка подставляет их везде:

- в HTML — вместо `{{title:ключ}}` и `{{price:ключ}}` (например, `{{price:watch}}` → `89 900`); неизвестный ключ останавливает сборку;
- в `src/js/app.js` — как `__PRICES__` (форма и итоговая сумма);
- в PHP — файл копируется в `dist/api/prices.json`, по нему `pay.php` считает сумму к оплате.

Чтобы поменять цену или название, правьте только `src/prices.json`.

### Промокоды

Промокоды заводятся в админке (раздел «Промокоды»): код, скидка в процентах (1–99), тарифы, на которые она действует, срок. Факультативы всегда без скидки. После сохранения админка пишет действующие коды в `~/private/<сайт>/promocodes.json`.

- В форме поле «Промокод» и кнопка «Применить»: `GET api/promo.php?code=…` возвращает процент и тарифы, форма пересчитывает итог. Если код не подходит к выбранному формату, форма об этом пишет.
- `pay.php` проверяет код заново и снижает цену тарифа на `round(цена × процент / 100)` ₽. В чеке строка тарифа идёт уже со скидкой, в заказе — `promo: {code, percent, discount}`, в письме организаторам — строка с промокодом.
- Неверный код в `promo.php` отвечает с задержкой 0,3 с, чтобы коды не подбирали перебором.
- На тестовом сайте каждая позиция стоит 1 ₽, поэтому скидка в сумме платежа не видна; в форме и в заказе она есть.

### Настройка на хостинге

Нужен PHP 8.1+ с `curl` и `openssl` (выбирается в панели reg.ru для каждого сайта).

Ключи и заказы лежат вне `www/`, в `~/private/<папка сайта>/` (`~/private/brandmasterskaya.ru/`, `~/private/test.brandmasterskaya.ru/`): rsync их не трогает, по HTTP они недоступны. `config.php` там пишет деплой из секретов репозитория, вручную его не правят. Ключи настроек описаны в [config.example.php](config.example.php).

1. В интернет-банке Точки: «Сервисы» → «Интеграции и API» → создать JWT-ключ с правами `MakeAcquiringOperation`, `ReadAcquiringData`, `ReadCustomerData`, `ManageWebhookData`. Сохранить JWT и `client_id`.
2. Узнать `customerCode` и `merchantId`:
   ```bash
   TOCHKA_JWT=… node scripts/tochka.mjs customers
   TOCHKA_JWT=… node scripts/tochka.mjs retailers <customerCode>
   ```
3. Положить их в секреты репозитория `TOCHKA_JWT`, `TOCHKA_CUSTOMER_CODE`, `TOCHKA_MERCHANT_ID`.
4. Создать ящик отправителя (`mail_from`, по умолчанию `noreply@brandmasterskaya.ru`).
5. После деплоя подключить вебхук (банк сразу присылает тестовый и ждёт ответ 200). На один `client_id` банк хранит один адрес ([FAQ Точки](https://developers.tochka.com/docs/tochka-api/faq)), поэтому вебхук основного ключа ведёт на боевой сайт:

   ```bash
   TOCHKA_JWT=… TOCHKA_CLIENT_ID=… node scripts/tochka.mjs webhook-edit https://brandmasterskaya.ru/api/webhook.php
   ```

   Чтобы вебхуки получал и тестовый сайт, нужен отдельный JWT-ключ только с правом `ManageWebhookData` и свой вебхук на него (`webhook-set https://test.brandmasterskaya.ru/api/webhook.php`). Чужие заказы каждый сайт пропускает.
   Без вебхука оплата тоже засчитывается: страница «Спасибо» сверяет статус через API.

6. Долями (оплата частями, [документация](https://dolyame.ru/develop/)): в секреты репозитория положить `DOLYAMI_MASTERSKAYA_LOGIN`, `DOLYAMI_MASTERSKAYA_PASS` и mTLS-сертификат с ключом, выпущенные в Т-Бизнесе, — `DOLYAME_CERT` и `DOLYAME_KEY` (содержимое PEM-файлов):
   ```bash
   gh secret set DOLYAME_CERT < 2-certificate-….pem
   gh secret set DOLYAME_KEY < 2-private.key
   ```
   Деплой кладёт их в `~/private/<папка сайта>/dolyame-{cert,key}.pem`; без них кнопка «Оплатить частями» скрыта. Кнопка скрыта у всех посетителей, пока в консоли браузера (`F12`) на странице сайта не введено `localStorage.dolyame = 'on'` (затем перезагрузить страницу); выключает `localStorage.removeItem('dolyame')`. Это включает кнопку только в этом браузере и не защищает серверный `pay.php`. Сайт передаёт в Долями `notification_url` = `/api/dolyame-webhook.php` (принимает только сети Долями и сверяет статус через API), заявка в статусе `wait_for_commit` подтверждается сразу, заказ считается оплаченным после `committed`. Чеки по 54-ФЗ для оплат через Долями пробивает чековый сервис Долями: к каждой позиции уходит `receipt` (`tax` из `vat_type`, «полный расчёт», «услуга»), в заявке и подтверждении `fiscalization_settings: enabled`. Нужна онлайн-касса, подключённая в Долями ([инструкция](https://dolyame.ru/develop/fiscalization/onlinekassa/)). Сертификат действует до 16.10.2027.

Журнал платежей: `~/private/<папка сайта>/payments.log`, заказы: `~/private/<папка сайта>/orders/`.

Для локальной проверки без денег: `BM_PRIVATE_DIR` указывает на папку с `config.php`, в нём `'sandbox' => true` и `customer_code`/`merchant_id` из песочницы (`1234567ab`, `200000000001098` с `payment_modes` `['sbp']`). Песочница сразу отвечает «оплачено».

При перевыпуске JWT меняются и токен, и `client_id`: обновите секрет `TOCHKA_JWT`, перезапустите деплой и заново подключите вебхук.

## Telegram-бот

Бот и админка для организаторов живут в [admin/](admin/README.md): Payload CMS и бот на grammY в одном Node-процессе на том же хостинге. У боевого сайта бот [@masterskaya_brand_strategy_bot](https://t.me/masterskaya_brand_strategy_bot) и админка [admin.brandmasterskaya.ru](https://admin.brandmasterskaya.ru), у тестового — [@masterskaya_brand_test_bot](https://t.me/masterskaya_brand_test_bot) и `admin.test.brandmasterskaya.ru`.

Запросы бота к Telegram идут через Cloudflare Worker ([worker/telegram-relay.js](worker/telegram-relay.js), workflow **Worker**): с хостинга соединения с `api.telegram.org` по IPv4 зависают на две минуты. Адрес Worker'а — в переменной репозитория `TELEGRAM_API_URL`, секреты Cloudflare — `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`.

Сайт с ботом напрямую не общается: бот раз в минуту читает заказы из `~/private/<сайт>/orders/` и список тарифов из `~/www/<сайт>/api/prices.json`, а по `/start <номер заказа>` читает файл заказа сразу.

## Проверки

- **Prettier** — форматирование.
- **ESLint** — JS.
- **Stylelint** (`stylelint-config-standard`) — CSS.
- **php -l** (только в CI) — синтаксис PHP.

Хук `pre-commit` проверяет изменённые файлы через lint-staged и не пропускает коммит с ошибками. Хук `pre-push` запрещает пушить в `main` напрямую.

## Процесс

1. Каждое изменение делается в отдельной ветке.
2. Коммиты оформляются по [Conventional Commits](https://www.conventionalcommits.org/ru/): `type(scope): описание`.
3. Изменения попадают в `main` только через pull request.
4. На каждый PR запускается CI (`check`): линтеры и сборка. Без зелёного CI смержить нельзя.

## Деплой

Workflow **Deploy** запускается на пуш, если меняются `src/`, `scripts/`, `package.json`, `package-lock.json`, `config.example.php` или сам `deploy.yml`. Правки документации и конфигов линтеров сайт не трогают. Чтобы пропустить деплой разово, добавьте `[skip ci]` в сообщение коммита.

| Ветка        | Сайт                                                         | Цены                  |
| ------------ | ------------------------------------------------------------ | --------------------- |
| `main`       | [brandmasterskaya.ru](https://brandmasterskaya.ru)           | настоящие             |
| любая другая | [test.brandmasterskaya.ru](https://test.brandmasterskaya.ru) | 1 ₽ за позицию в чеке |

Тестовый сайт — общий для всех веток, там последний пуш. Платежи на нём настоящие (через боевой API Точки), но на 1 ₽ за тариф и каждый факультатив; на странице показываются обычные цены. Тестовый сайт закрыт от поисковиков (`robots.txt`).

Шаги деплоя:

1. проверки и сборка;
2. запись `~/private/<сайт>/config.php` из секретов;
3. загрузка `dist/` в `~/www/<сайт>/` через rsync по SSH.

Rsync сравнивает файлы по содержимому и удаляет на сервере лишнее. Папка `.well-known/` и файл `.htaccess` на сервере не трогаются.

Админка и бот деплоятся отдельным workflow **Admin** при изменениях в `admin/`, см. [admin/README.md](admin/README.md#деплой).

Секреты репозитория: доступ к серверу — `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_HOST`, `SSH_USER`; Точка — `TOCHKA_JWT`, `TOCHKA_CUSTOMER_CODE`, `TOCHKA_MERCHANT_ID`. Деплой можно запустить и вручную: Actions → Deploy → Run workflow (выберите ветку).

## Лицензия

Все права защищены. Использование, копирование и распространение без письменного разрешения запрещены. Подробнее в [LICENSE](LICENSE).
