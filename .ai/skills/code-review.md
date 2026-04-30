---
name: code-review
description: Review a druz9 PR or diff against the project's hard rules — proto-first contract, free-only LLM, clean architecture, security gates, conventional commits. Use before merging anything non-trivial.
---

# Code review

Чек-лист, по которому проверяется любой PR в этот репо. Не «всё подряд», а конкретные вещи, которые ломаются чаще всего.

## Когда применять

- Перед merge любого PR.
- Когда читаешь чужой diff и хочешь оставить осмысленный комментарий.
- Перед собственным push'ом — самопроверка.

## Не применять

- Косметические фиксы (опечатки, форматирование) — пропускаем сразу.
- Generated файлы (`backend/shared/generated/`, `frontend/src/api/generated/`) — не ревьюим, проверяем только что они в коммите.

## Чек-лист

### Контракт

- [ ] Изменения API начинаются с `.proto`?
- [ ] `make gen-proto` запущен и generated файлы в коммите?
- [ ] CI `make gen-check` зелёный? (Если красный — drift, миша забыл регенерировать.)
- [ ] Если есть REST-альтернатива — `google.api.http` аннотация в proto, не ручной handler?

### Бэкенд: чистая архитектура

- [ ] Бизнес-логика в `app/`, не в `ports/`?
- [ ] Domain-интерфейсы объявлены в `domain/repo.go`, не в `infra/`?
- [ ] Сервис A не импортирует сервис B напрямую? Если общение нужно — через `shared/domain/events.go` + EventBus.
- [ ] Errors с префиксом: `fmt.Errorf("foo.Bar: %w", err)`?
- [ ] `context.Context` первый аргумент в публичных функциях?
- [ ] Sentinel errors в `domain/errors.go`, маппятся в Connect-codes через `httperr` в ports?

### Бэкенд: безопасность

- [ ] LLM-endpoint обёрнут в `quota.Check` + `quota.Consume`?
- [ ] LLM-endpoint обёрнут в `killswitch.Check`?
- [ ] User-controlled input в LLM prompt'е завернут в `<<<USER_DOC>>>` / `<<<TRANSCRIPT>>>` delimiters?
- [ ] Bearer auth обязателен (`/auth/*` и `/health` — исключения)?
- [ ] Cross-user leak protection: возврат 404, а не 403, для foreign-id?
- [ ] Запросы к внешним URL (если есть) — через `services/documents/infra/url_fetcher.go` с SSRF guard?
- [ ] Логи не содержат секретов / PII?

### LLM-стек

- [ ] **Только бесплатные провайдеры.** Никаких Anthropic / OpenAI / Cloudflare / SambaNova / Gemini напрямую (Gemini через OpenRouter `:free` — ОК).
- [ ] Вызов через `llmchain.Run`, а не прямой `http.Post` к Groq?
- [ ] Если задача deterministic и дорогая — обёрнута в `llmcache`?
- [ ] Floor-адаптер (`NoLLMFoo{}`) есть для graceful degradation?
- [ ] Floor возвращает `domain.ErrLLMUnavailable`, не nil?

### БД и миграции

- [ ] Миграция в `backend/migrations/<NNNNN>_<topic>.sql` с up + down?
- [ ] FK на `users(id)` имеют `ON DELETE CASCADE`?
- [ ] Большие индексы создаются через `CONCURRENTLY` + `-- +goose NO TRANSACTION`?
- [ ] Если sqlc-queries затронуты — `make gen-sqlc` запущен?
- [ ] DROP COLUMN не происходит одновременно с deploy кода, который его использует?

### Frontend

- [ ] Strict TS — нет `@ts-nocheck`, нет `any` без обоснования в комментарии?
- [ ] Loading / error / empty states есть отдельно (не inline-тернарии)?
- [ ] Server state через react-query, не `useEffect + fetch`?
- [ ] Generated types из `@generated/`, не дублируются в `types.ts`?
- [ ] Hone-эстетика на новой web-странице (после ADR-001 Phase-4)?
- [ ] CSS — utility-first / variables, не `style={{}}` без причины?

### Hone-специфика

- [ ] Не делает stealth (нет `setContentProtection`, нет global hotkeys)?
- [ ] Hотken Esc возвращает в Home?
- [ ] Команда добавлена в ⌘K Palette?
- [ ] Не использует `keytar` (только `safeStorage`)?

### Cue-специфика

- [ ] IPC-канал зарегистрирован в `main/ipc/schemas.ts` через zod?
- [ ] Stealth не сломан (если затронут window-manager)?
- [ ] Native binary подписан в pre-build hook (если затронут native/audio-mac)?

### Тесты

- [ ] Unit-тесты для use-case'ов в `app/<usecase>_test.go`?
- [ ] Покрыты: happy path + permission denied + not found + invalid input?
- [ ] `go test -race ./...` зелёный?
- [ ] `make lint` зелёный?

### Коммит / PR

- [ ] Conventional Commits формат? (`feat(scope): ...`, `fix(scope): ...`)
- [ ] Сообщение коммита на английском, императив, без точки?
- [ ] **Нет упоминаний** ChatGPT / Codex / Claude / Anthropic в commit-сообщениях или коде?
- [ ] **Нет тегов** «Generated with X» в коде / коммитах?
- [ ] Нет `--no-verify`, нет `--amend` опубликованного commit'а?
- [ ] PR-описание объясняет **why**, не what?
- [ ] Test plan в PR-описании — что вручную проверено?

### Скоуп / YAGNI

- [ ] Нет лишних абстракций «на будущее»?
- [ ] Нет feature flags / backwards-compat shims (для одиночного разработчика — режем)?
- [ ] Нет TODO / FIXME без owner'а?
- [ ] Нет half-finished implementations (если фича незавершена — не merge'им)?

### Документация

- [ ] Если меняется поведение, документированное в `docs/tech/` — `.md` обновлён?
- [ ] Удалённый код не оставил ссылок-зомби в `docs/tech/` или `CLAUDE.md`?
- [ ] Новый сервис / большая фича — упомянута в `docs/tech/backend.md` (или соответствующем)?

## Что флагать как блокер vs nit

**Блокеры** (не merge'им):
- Платный LLM-провайдер.
- Нет миграции down.
- Cross-user leak (foreign-id возвращает 403, выдаёт user-id).
- `--no-verify` без явной причины.
- Утекли секреты в коде.
- generated drift в коммите.

**Серьёзные но не блокеры** (просим править):
- Нет тестов на use-case.
- Нарушение clean architecture (бизнес-логика в ports).
- Нет loading state на странице.
- Hone-страница без Esc.

**Nit** (можно проигнорировать на review, оставить в TODO):
- Перепутана группа импортов.
- Кастомные комментарии-объяснения (если они уместны — ОК, если нет — попросить убрать).
- Имя переменной не идеальное.

## Anti-patterns у reviewer'а

- ❌ **Bikeshedding.** Имена переменных, формат комментариев — это не review.
- ❌ **Просьбы добавить «на всякий случай» абстракцию.** Если не нужно сейчас — не нужно.
- ❌ **«А что если потом понадобится X».** YAGNI. Решим когда понадобится.
- ❌ **Без конкретного «почему».** Каждое «измени это» должно объяснять причину.
- ❌ **Игнор PR из-за стиля письма.** Содержание > форма.

## Related

- [docs/tech/conventions.md](../../docs/tech/conventions.md) — полные правила
- [.ai/skills/add-rpc.md](./add-rpc.md) — что должно быть в новом endpoint'е
- [.ai/skills/llmchain-task.md](./llmchain-task.md) — как ревьюить LLM-задачу
