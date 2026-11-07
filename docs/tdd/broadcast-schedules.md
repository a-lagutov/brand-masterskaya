# Расписание рассылок: проверка TDD

План: [broadcast-schedules.md](../plans/broadcast-schedules.md).
Ветка реализации: `feat/broadcast-schedules`; зависимость — `533cffb` (`feat/admin-bulk-tools`).

## RED и GREEN

Перед изменением production-кода выполнен `RUN_BOT= TELEGRAM_BOT_TOKEN= npm --prefix admin test` на Node.js 22.20.0.
Исходные 36 тестов прошли, шесть новых целей упали: отсутствовал календарный модуль,
не существовал диспетчер расписаний, подтверждение сразу ставило будущую рассылку в очередь,
служебные поля не были защищены. RED сохранён коммитом `95d9057`, достижимым из исходной ветки реализации.

Дополнительные регрессии сначала воспроизведены тестами: пустая будущая аудитория ошибочно
блокировала подтверждение; отмена после чтения списка не предотвращала создание запуска;
скрытая дата окончания повторов влияла на однократную отправку; ошибки подготовки скрывали
причину; активные формы оставались редактируемыми; пустая аудитория обходила проверку шаблона.
После исправлений итоговый полный запуск дал `54 tests`, `54 pass`, `0 fail`, `0 skipped`.
GREEN сохранён отдельным локальным коммитом `f94348a` вместе с реализацией и этим отчётом.

## Гарантии

| Поведение                                                                                                                                                  | Тест                                                                                                     | Уровень            | Результат |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------ | --------- |
| Дневной, недельный и месячный календарь сохраняет московское время, корректно обрабатывает конец месяца, високосный год, окончание и пропущенные интервалы | `admin/tests/broadcastSchedule.test.mjs`                                                                 | Unit               | PASS      |
| Будущая рассылка включается отдельно от сохранения; до срока запуск не создаётся, пустая текущая аудитория допустима                                       | `scheduledBroadcasts.test.mjs`: `approval schedules…`, `scheduled approval permits…`                     | Integration        | PASS      |
| Каждый запуск получает актуальные переменные, не пересекается с предыдущим и не повторяется после восстановления записи                                    | `scheduledBroadcasts.test.mjs`: `each occurrence…`, `restart after child creation…`, `concurrent ticks…` | Integration        | PASS      |
| Отмена останавливает будущие запуски, включая гонку со старым списком; завершение дочернего запуска завершает однократное расписание                       | `scheduledBroadcasts.test.mjs`: `one-time schedule…`, `scheduler rechecks…`                              | Integration        | PASS      |
| Бот и личный аккаунт сохраняют выбранного отправителя; планирование не вызывает отправку Telegram                                                          | `scheduledBroadcasts.test.mjs`: `personal scheduled runs…`; существующие тесты обоих транспортов         | Integration        | PASS      |
| Пустая аудитория не обходит проверку переменных и ссылок; ошибки подготовки видны, служебные поля защищены, активные формы имеют права только на чтение    | `scheduledBroadcasts.test.mjs`: проверки ошибок, metadata и permissions                                  | Integration        | PASS      |
| Production-миграции создают историю запусков и уникальный ключ; дубликат отвергается, пауза другой рассылки не блокирует готовую очередь                   | `admin/tests/scheduleStorage.test.mjs`                                                                   | SQLite integration | PASS      |
| Откат и повторное применение миграции сохраняют старый текст, участников, связи и результаты доставки                                                      | `admin/tests/scheduleStorage.test.mjs`                                                                   | SQLite integration | PASS      |

## Команды и окружение

Все проверки выполнены с Node.js 22.20.0. Бот отключён для сборок и общей инициализации.
Транспортные тесты подставляют фиктивный токен и заменяют Telegram API до вызовов.
SQLite-базы создаются в отдельном временном каталоге и удаляются после тестов.

- `npm run check` — PASS: type checking, ESLint, Stylelint, BEM, Prettier.
- `npm run build` — PASS.
- `for file in src/api/*.php config.example.php; do php -l "$file"; done` — PASS.
- `RUN_BOT= TELEGRAM_BOT_TOKEN= npm --prefix admin run typecheck` — PASS.
- `RUN_BOT= TELEGRAM_BOT_TOKEN= npm --prefix admin test` — PASS, 54 теста.
- `DATABASE_URL=file:/private/tmp/brand-schedule-build.db PAYLOAD_SECRET=build-only RUN_BOT= TELEGRAM_BOT_TOKEN= npm --prefix admin run build` — PASS, production-сборка Next.js.
- Payload `generate:types`, `generate:importmap`, `migrate:create -- broadcast_schedules` — выполнены; результат просмотрен. Откат с пересозданием таблицы заменён удалением только новых колонок, чтобы сохранить связанные записи.
- `git diff --check` — PASS.

Из корня репозитория отдельно выполнен coverage:

```bash
RUN_BOT= TELEGRAM_BOT_TOKEN= node \
  --import ./admin/node_modules/tsx/dist/loader.mjs \
  --experimental-test-coverage \
  '--test-coverage-include=**/src/bot/broadcastSchedule.ts' \
  '--test-coverage-include=**/src/bot/broadcasts.ts' \
  --test admin/tests/broadcastSchedule.test.mjs \
  admin/tests/scheduledBroadcasts.test.mjs \
  admin/tests/broadcasts.test.mjs admin/tests/scheduleStorage.test.mjs
```

Календарный модуль: строки 100%, ветви 97,30%, функции 100%.
Общий модуль рассылок: строки 89,13%, ветви 87,42%, функции 63,16%.
Суммарно для выбранных модулей: строки 90,53%, ветви 89,29%, функции 69,57%.
Порог 80% достигнут по строкам и ветвям; совокупная метрика функций остаётся ниже 80%.
Эта цифра относится ко всему прежнему и новому модулю рассылок, а не только к календарю.

Браузерная проверка и UI coverage не выполнялись: пользователь запретил computer use.
Настоящие сообщения, платежи и удалённые данные не затрагивались. Выполнен ручной просмотр diff
на права доступа, секреты, повторное создание запусков, неопределённую доставку и сохранность данных.
На момент завершения реализации push, PR и деплой не выполнялись. После отдельного запроса владельца production-ветка `feat/admin-production-release` собирается от актуального main одним коммитом; этот отчёт сохраняет исходные RED/GREEN доказательства при таком объединении. Исходная ветка и история не переписываются.
