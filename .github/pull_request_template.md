## Что и зачем

<!-- Что меняется для посетителя сайта, покупателя, заказчика в админке или в боте. -->

## Что затронуто

- [ ] Сайт (`src/`, `scripts/build.mjs`)
- [ ] Оплата (`src/api/`)
- [ ] Админка и бот (`admin/`)
- [ ] Схема базы админки (новая миграция в `admin/src/migrations/`)
- [ ] Ретранслятор Telegram (`worker/`)
- [ ] Выкладка, секреты, переменные GitHub (`.github/workflows/`)

## Проверка на тесте

<!-- Ветка уже выложена на test.brandmasterskaya.ru и admin.test.brandmasterskaya.ru. -->

- [ ] Страница и форма на test.brandmasterskaya.ru, в том числе на телефоне
- [ ] Оплата проходит, страница подтверждения заказа ведёт в бота
- [ ] Бот @masterskaya_brand_test_bot отвечает на `/start` и пускает в чаты
- [ ] Изменения видны в admin.test.brandmasterskaya.ru

## После слияния в main

<!-- Слияние выкладывает brandmasterskaya.ru, admin.brandmasterskaya.ru и боевого бота. -->

- [ ] Ничего вручную делать не нужно
- [ ] Нужно вручную: <!-- секрет, настройка в панели reg.ru, текст в админке… -->
