# Конвенции

Жёсткие правила. Нарушение = реверт без обсуждения.

## Контракт API

- **Источник правды — `proto/druz9/v1/`.** Любое изменение API начинается с правки .proto.
- **Generated файлы коммитятся.** `frontend/src/api/generated/`, `backend/shared/generated/pb/` — в git. CI проверяет drift через `make gen-check`.
- **Один сервис = один .proto файл.** Не группируем service A + service B в один файл.
- **REST-альтернатива через `google.api.http`** — vanguard-go transcoder снимает её автоматически. Не пишем дублирующий REST-handler руками.

Workflow добавления нового RPC: см [.ai/skills/add-rpc.md](../../.ai/skills/add-rpc.md).

## LLM-провайдеры

**Только бесплатные tier'ы.** Полный список разрешённых:

- Groq (primary)
- Cerebras
- Mistral
- OpenRouter (`:free` lane)
- Ollama (self-hosted floor)

**Запрещено:**

- Anthropic (Claude API напрямую)
- OpenAI (GPT-4 / 5)
- Google Gemini напрямую (через OpenRouter `:free` — допустимо)
- Cloudflare Workers AI
- SambaNova

Это правило существует, потому что:
1. **Маржинальность.** Каждый платный токен → отрицательный unit economics на free-tier пользователях.
2. **Стабильность tier'ов.** Бесплатные провайдеры вынуждены быть быстрыми — иначе никто не пользуется.
3. **Fallback-граф.** llmchain переключается между провайдерами по ошибкам / лимитам — пользователь не видит downtime.

Когда придёт момент монетизации Pro on-top API → будем добавлять платный провайдер с явным opt-in. Не сейчас.

## Go-стиль

- **gofmt.** Точка.
- **goimports.** Группы: stdlib → external → internal.
- **Errors:** `fmt.Errorf("foo.Bar: %w", err)` — обязательно префикс домена + операции.
- **Interfaces объявляются у consumer'а.** `app/` объявляет интерфейс, `infra/` имплементит. Не наоборот.
- **`switch` по enum'у — exhaustive.** Линтер `exhaustive` ловит непокрытые cases.
- **Никаких `interface{}` в публичных API.** Только конкретные типы или generics.
- **Никакого `panic` в продакшен-коде.** Только в `init()` или конфигурационных guard'ах.
- **`context.Context` первый аргумент.** Всегда.
- **`go vet ./...` + `staticcheck` + `golangci-lint run`.** Зелёные в CI.

См [Effective Go](https://golang.org/doc/effective_go) и [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md).

## TypeScript-стиль

- **`strict: true`.** Никаких `@ts-nocheck`, `@ts-ignore`, `any`.
- **Narrow перед использованием.** `unknown` лучше чем `any`.
- **Чистый функциональный React.** Никаких `class Component`. Кастомные хуки для всего разделяемого.
- **`type` over `interface`** для props (за исключением extends-цепочек).
- **`zod`** для runtime-валидации внешних данных (IPC в Electron, query strings).
- **Style — Tailwind + CSS variables.** Никаких `style={{}}` inline кроме редких runtime-вычислений.

## Сообщения коммитов (Conventional Commits)

Формат:

```
<type>(<scope>): <imperative description>

<optional body>
```

**Типы:** `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `style`, `perf`, `ci`, `build`.

**Правила:**

- Первая строка ≤ 72 символа (целевая длина ~50).
- Императив, настоящее время («add», не «added»).
- Без точки в конце.
- Без заглавной (если не имя собственное).

**Примеры:**

```
feat(hone): daily focus goal setting in Settings → Stats Goal Meter
fix(cue): stale shortcuts + expanded footer plan badge for unlimited users
refactor(copilot): extract mock-block check into separate gate
```

**Запрещено:**

- Упоминать ChatGPT / Codex / Claude / Anthropic в коммитах.
- Теги `Generated with X` в коде или коммитах.
- `--no-verify` (skip hooks). Если хук падает — фиксим причину, не обходим.
- `--amend` опубликованного коммита. Только новый.

## Pull requests

- **Один PR — одна цель.** Не смешиваем рефакторинг с feature.
- **Generated files в отдельном коммите.** Чтобы reviewer мог пропустить.
- **Описание содержит why,** не what (what читается из diff).
- **Test plan в описании** — что вручную проверено.

## Тесты

- **Backend:** unit-тесты в `app/<usecase>_test.go` через hand-rolled fakes. `go test -race ./...` зелёный.
- **Frontend web:** Vitest + RTL для критических компонентов. UI ручной + Playwright (когда дойдут руки).
- **Hone / Cue:** ручное smoke-тестирование. Playwright не настроен.
- **Migrations:** smoke-test на staging до merge в main, если миграция нетривиальная (drop column / rename / data migration).

## Git workflow

- **Работа в основной ветке (`main`).** Не используем feature branches для одиночной разработки. Worktrees запрещены явным указанием Sergey.
- **Pull rebase** перед push.
- **Force-push в main запрещён** (даже после rebase — создаём merge commit).

## Codegen workflow

После любого изменения `.proto` или `.sql` (sqlc):

```bash
make generate    # gen-proto + gen-sqlc + gen-mocks + gen-ts
git add proto/ backend/shared/generated/ frontend/src/api/generated/
```

CI ловит drift — забывшие = revert.

## Безопасность

- **Никаких секретов в коде.** `.env*` файлы в `.gitignore`. Реальные секреты — только в GitHub Secrets / VPS env.
- **Никаких credentials в логах.** Slog инлайнит, redact обязательно.
- **`solution_hint`** не отдаётся клиенту, кроме admin-ручек (явная role-gate).
- **Bearer auth** обязателен на всех `/api/v1/*` (кроме `/auth/*` и `/health`).
- **Rate-limit** обязателен на любой LLM-endpoint — `shared/pkg/ratelimit`.
- **Token quota** проверяется перед LLM-вызовом — `shared/pkg/quota.Check` → 429 если cap.

## Ошибки

- **Sentinel errors** в `domain/errors.go`: `ErrNotFound`, `ErrPermissionDenied`, `ErrLLMUnavailable`, ...
- **Маппинг в Connect-RPC коды** в `ports/server.go` через `httperr` helpers.
- **Логи на английском, lowercase, с контекстом.** «failed to load plan: pgx: row not found» — ОК. «Ошибка!» — нет.

## Документация

- **Code-comments — минимум.** Только если *почему* неочевидно. *Что* делает функция — читается из имени и сигнатуры.
- **`README.md` на сервис** — короткий, не дублирует тех-дизайн (тех-дизайн в `docs/tech/`).
- **CHANGELOG'и не пишем.** История в git. PR-описания — источник правды для «что изменилось».

## Чего не делаем

- ❌ **Не вводим feature flags для одиночной разработки.** В команде из одного человека — режем YAGNI.
- ❌ **Не пишем backwards-compatibility shims для unused кода.** Удалили — значит удалили.
- ❌ **Не добавляем абстракции «на будущее».** Три похожих места кода лучше преждевременной абстракции.
- ❌ **Не пишем тесты для thin pass-through кода.** Ports-handler, который вызывает один app-метод и возвращает результат — не нужно тестить.
- ❌ **Не пишем документацию, которая никогда не читается.** `docs/` чистится регулярно.

## Если сомнения

- Какая фича чья (web / Hone / Cue) — см [feature/identity.md](../feature/identity.md) §«Three surfaces» (web learning / Hone doing / Cue performing).
- Как добавить LLM-задачу — [.ai/skills/llmchain-task.md](../../.ai/skills/llmchain-task.md).
- Как добавить миграцию — [.ai/skills/add-migration.md](../../.ai/skills/add-migration.md).
- Какой тон в коммите / PR — копируем стиль из последних 10 коммитов в `git log`.
