# Известные STUB'ы

`// STUB:` маркеры в проде — осознанные пропуски, работающие для MVP, но требующие реализации перед scale-out / B2B / выходом из beta. Точный список плавает по мере фиксов; используй `make check-stubs` для актуального грепа.

> Найти все: `make check-stubs` (или `grep -rn "// STUB:" backend/ | grep -v _test.go`).

## Известные категории риска

### 🔴 Блокеры до выхода из beta

| Файл | Что не сделано | Симптом |
|---|---|---|
| `services/notify/infra/email.go` | Email-sender только логирует, не шлёт. | Подписки на event-reminders / weekly digest не приходят на email. |
| `services/notify/infra/webpush.go` | WebPush-sender то же — лог, не отправка. | Браузерные пуши не работают. |
| `services/auth/infra/encryptor.go` | Encryption key из env, без secrets manager. | Если env leak'нет → токены compromised. До B2B/Enterprise — критично. |
| `services/ai_mock/ports/ws_handler.go` | `Upgrader.CheckOrigin` allow-all. | CSRF-уязвимость WS-эндпоинта. |
| `services/whiteboard_rooms/ports/ws_handler.go` | То же — allow-all CheckOrigin. | Та же уязвимость. |

### 🟡 Качество product/UX

| Файл | Что не сделано | Симптом |
|---|---|---|
| `services/notify/app/worker.go` | Дайджест после 1 мин — нет, шлём каждый event. | Пользователь получает спам уведомлений если 5 ивентов разом. |
| `services/notify/app/handlers.go` | Имя интервьюера hardcode'нуто как «интервьюер». | В push-уведомлениях не подставляется реальное имя. |
| `services/profile/app/report.go` | LLM narrative для weekly-report — заглушка. | Weekly Report показывает шаблонный текст, не AI-анализ. |
| `services/admin/app/update_config.go` | Audit log изменений config'а в проде — partial (есть `admin_audit_log` table, но не везде wired). | Не везде видно «кто что когда поменял». |
| `services/profile/domain/service.go` | Hardcoded thresholds вместо `dynamic_config`. | Нельзя крутить пороги без деплоя. |

### 🟢 Технический долг (низкий приоритет)

| Файл | Что |
|---|---|
| `services/hone/ports/server.go` | Закомментированный handler-stub оставлен на случай proto-rewiring. |
| `services/auth/infra/encryptor.go` | `TokenDecryptor` интерфейс — только когда понадобится consumer. |
| `services/ai_mock/app/worker.go` | Asynq-wiring (background worker) вместо in-process — для scale-out. |
| `services/ai_mock/infra/postgres.go` | `llm_model_override` + `default_level` в companies schema. |
| `services/ai_mock/app/send_message.go` | Token-count overflow handling. |
| `services/copilot/app/` | Real token streaming — сейчас одно `done`-event вместо chunk-stream. |

## Конвенция

- `// STUB:` пишем когда **сознательно отложили реализацию**. Не как «TODO когда дойдут руки» — как контрактный маркер.
- Каждый STUB должен объяснять **что не сделано** и **что должно быть**, чтобы следующий dev мог продолжить.
- При закрытии STUB'а — удалить комментарий целиком, не превращать в `// was a stub`.
- `make check-stubs` запускается локально для self-review. CI **не** ловит STUB'ы — это осознанно (если ловить, мерж блокируется до полной имплементации, что не наш scale).

## Когда чистить

- **Перед B2B/Enterprise pitch** — категория 🔴 must быть закрыта.
- **Перед выходом из beta** — закрыть 🔴 + audit-log из 🟡.
- **Когда упрётся в metric** — например, если weekly-report retention падает, фиксить `services/profile/app/report.go` LLM narrative.

## История

Большинство STUB'ов закрыто за Wave R0-Wave6:
- Большая часть `services/copilot/`, `services/intelligence/`, `services/tutor/`, `services/hone/`.
- Удалены вместе с сервисами: `services/arena/judge0`, `services/rating/*`, `services/daily/*`, `services/profile/streaks_repo` и др.
- LLM-провайдеры migrated на free-tier chain (раньше был стаб для Anthropic).
