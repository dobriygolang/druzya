# Известные STUB'ы

35 точек с `// STUB:` в проде. Не баги — осознанные пропуски, которые работают для MVP, но требуют реализации перед scale-out / B2B / выходом из beta.

> Найти все: `make check-stubs` (или `grep -rn "// STUB:" backend/ | grep -v _test.go`).

## По степени риска

### 🔴 Блокеры до выхода из beta

| Файл | Что не сделано | Симптом |
|---|---|---|
| `services/notify/infra/email.go:15` | Email-sender только логирует, не шлёт. | Подписки на event-reminders / weekly digest не приходят на email. |
| `services/notify/infra/webpush.go:15` | WebPush-sender то же — лог, не отправка. | Браузерные пуши не работают. |
| `services/arena/infra/judge0.go:15` | `FakeJudge0` принимает любое решение. | Code execution в арене — заглушка. На паре путей реальный Judge0 уже подключён, но не везде. |
| `services/auth/infra/encryptor.go:25` | Encryption key из env, без secrets manager. | Если env leak'нет → токены compromised. До B2B/Enterprise — критично. |
| `services/ai_mock/ports/ws_handler.go:42` | `Upgrader.CheckOrigin` allow-all. | CSRF-уязвимость WS-эндпоинта. |
| `services/whiteboard_rooms/ports/ws_handler.go:30` | То же — allow-all CheckOrigin. | Та же уязвимость. |

### 🟡 Качество product/UX

| Файл | Что не сделано | Симптом |
|---|---|---|
| `services/notify/app/worker.go:108` | Дайджест после 1 мин — нет, шлём каждый event. | Пользователь получает спам уведомлений если 5 ивентов разом. |
| `services/notify/app/handlers.go:232` | Имя интервьюера hardcode'нуто как «интервьюер». | В push-уведомлениях не подставляется реальное имя. |
| `services/daily/domain/service.go:72` | Readiness formula упрощена. | Forecast в Insights менее точный, чем заявлено. |
| `services/profile/app/report.go:54` | LLM narrative для weekly-report — заглушка. | Weekly Report показывает шаблонный текст, не AI-анализ. |
| `services/admin/app/update_task.go:20` | Bulk import задач из CSV не работает. | Curator-работа замедлена, но не блокирована. |
| `services/admin/app/list_anticheat.go:12` | Bulk actions над anticheat-сигналами. | Ручная обработка вместо batch'а. |
| `services/admin/app/update_config.go:33` | Audit log изменений config'а. | Не видно «кто что когда поменял». |
| `services/profile/infra/streaks_repo.go:33` | `rating_change` + `xp_earned` в streak-history — нули. | Streak-card в Hone Stats показывает только дату/факт, без delta. |
| `services/profile/domain/service.go:97` | Hardcoded thresholds вместо `dynamic_config`. | Нельзя крутить пороги без деплоя. |

### 🟢 Технический долг (низкий приоритет)

| Файл | Что |
|---|---|
| `services/rating/app/handlers.go:57` | Section из TaskID через daily/TaskRepo read-through — упрощено. |
| `services/rating/infra/postgres.go:128` | Real history join (`arena_participants + mock_sessions`) не написан. |
| `services/rating/infra/redis.go:20` | Sorted Set вместо текущего naive-storage — будущая оптимизация. |
| `services/rating/domain/repo.go:58` | History возвращает empty пока arena/mock не подсыпали. |
| `services/rating/ports/server.go:63` | `HistoryLast12Weeks` не подключён через ports. |
| `services/hone/ports/server.go:42` | Закомментированный handler-stub оставлен на случай proto-rewiring. |
| `services/auth/infra/encryptor.go:57` | `TokenDecryptor` интерфейс — только когда понадобится consumer. |
| `services/ai_mock/app/worker.go:18` | Asynq-wiring (background worker) вместо in-process — для scale-out. |
| `services/ai_mock/infra/postgres.go:253` | `llm_model_override` + `default_level` в companies schema. |
| `services/ai_mock/app/send_message.go:326` | Token-count overflow handling. |

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

Раньше было ~50 STUB'ов в начале Phase 1. Закрыто:
- Большая часть `services/copilot/`, `services/intelligence/`, `services/tutor/`.
- Hone-skeleton полностью имплементирован (см `backend/services/hone/README.md`).
- LLM-провайдеры migrated на free-tier chain (раньше был стаб для Anthropic).
