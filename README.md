# Мастерская бренд-стратегии

Лендинг авторской программы Антона Аверьянова и Михаила Чернышова.

Сайт: https://brandmasterskaya.ru

## Структура

```
src/                исходники сайта
  index.html
  css/style.css
  js/app.js
  send.php          приём заявок с формы
  assets/images/    фотографии (без уменьшения)
  assets/logos/     логотипы (уменьшаются до 480 px)
scripts/build.mjs   сборка src/ → dist/
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
```

Посмотреть сборку локально:

```bash
python3 -m http.server 4173 -d dist
```

## Сборка

`scripts/build.mjs` собирает `src/` в `dist/`:

- CSS и JS минифицируются через esbuild и встраиваются в `index.html`;
- HTML минифицируется;
- PNG и JPEG конвертируются в WebP, логотипы уменьшаются до 480 px по ширине;
- в `dist/` попадают только файлы, на которые ссылается страница, и `send.php`.

## Заявки

Форма отправляет JSON на `send.php`:

```json
{
  "name": "Иван Петров",
  "contact": "@ivanpetrov",
  "plan": { "title": "Смотрю и работаю", "price": 219900 },
  "electives": [{ "title": "Продвинутый бренд-директор", "price": 69900 }],
  "total": 289900,
  "currency": "RUB"
}
```

`send.php` проверяет заявку, пересчитывает цены по своему каталогу и пересылает её в том же виде на вебхук. Названия тарифов и цены заданы в двух местах — `src/js/app.js` и `src/send.php`, менять нужно оба.

Защита от спама: скрытое поле-ловушка, не больше 5 заявок с одного IP за 10 минут, запросы только с `brandmasterskaya.ru`.

Адрес вебхука хранится на сервере вне папки сайта, деплой его не трогает. Создать один раз:

```bash
mkdir -p ~/config && chmod 700 ~/config
printf "<?php return ['webhook_url' => '%s'];\n" 'https://…' > ~/config/application.php
chmod 600 ~/config/application.php
```

Пока файла нет, форма отвечает ошибкой «не удалось отправить».

## Проверки

- **Prettier** — форматирование.
- **ESLint** — JS.
- **Stylelint** (`stylelint-config-standard`) — CSS.

Хук `pre-commit` проверяет изменённые файлы через lint-staged и не пропускает коммит с ошибками. Хук `pre-push` запрещает пушить в `main` напрямую.

## Процесс

1. Каждое изменение делается в отдельной ветке.
2. Коммиты оформляются по [Conventional Commits](https://www.conventionalcommits.org/ru/): `type(scope): описание`.
3. Изменения попадают в `main` только через pull request.
4. На каждый PR запускается CI (`check`): линтеры и сборка. Без зелёного CI смержить нельзя.

## Деплой

Мерж в `main` запускает workflow **Deploy**, если меняет `src/`, `scripts/`, `package.json`, `package-lock.json` или сам `deploy.yml`. Правки документации и конфигов линтеров сайт не трогают. Чтобы пропустить деплой разово, добавьте `[skip ci]` в сообщение merge-коммита.

Шаги деплоя:

1. проверки и сборка;
2. загрузка `dist/` на хостинг reg.ru через rsync по SSH.

Rsync сравнивает файлы по содержимому и удаляет на сервере лишнее. Папка `.well-known/` и файл `.htaccess` на сервере не трогаются.

Доступ к серверу хранится в секретах репозитория: `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_HOST`, `SSH_USER`. Деплой можно запустить и вручную: Actions → Deploy → Run workflow.

## Лицензия

Все права защищены. Использование, копирование и распространение без письменного разрешения запрещены. Подробнее в [LICENSE](LICENSE).
