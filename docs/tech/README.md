# docs/tech — техническая база

Точка входа для разработчика, который видит проект впервые. Каждый файл — самодостаточный, без внутреннего раздувания.

## Файлы

| Файл | Когда читать |
|---|---|
| [architecture.md](./architecture.md) | Первое, что читать. Общая картина: что где живёт, как поверхности связаны, ключевые паттерны |
| [backend.md](./backend.md) | Перед работой с `backend/`. Структура монолита, сервисы, llmchain, БД, события |
| [frontend.md](./frontend.md) | Перед работой с `frontend/`, `hone/`, `cue/`. Codegen, transport, state, страницы |
| [deployment.md](./deployment.md) | Перед деплоем / провижном. CI/CD, VPS setup, релизы Electron-приложений |
| [observability.md](./observability.md) | Что мерится (метрики/логи/Sentry), какие dashboard'ы и алерты, куда они приходят |
| [runbook.md](./runbook.md) | Когда что-то горит. Команды для on-call: сайт лежит, LLM упали, миграция сломалась, kill-switch'и |
| [stubs.md](./stubs.md) | Известные `// STUB:` точки в проде, ранжированные по риску (🔴 блокеры → 🟡 UX → 🟢 техдолг) |
| [conventions.md](./conventions.md) | Перед первым коммитом. Стиль коммитов, Go-style, кодоген, правило free-only LLM |

## Быстрый старт

```bash
cp .env.example .env
make start       # backend (postgres + redis + minio + clickhouse + judge0 + api)
make front       # web (Vite, http://localhost:5173)
cd hone && npm run dev    # Hone Electron
cd cue && npm run dev     # Cue Electron
```

После любых изменений в `proto/`:

```bash
make generate   # gen-proto + gen-sqlc + gen-mocks + gen-ts
make gen-check  # CI-style проверка drift
```

## Состояние проекта (2026-05-12 post-marathon)

- **~25 backend-сервисов** в монолите (`backend/services/`). Все wired через `cmd/monolith/services/<svc>.go`. Новый: `google_calendar/` (Stream E). Stripped: `editor/` + `whiteboard_rooms/` (WS removed, solo persistence kept).
- **~28 .proto файлов** в `proto/druz9/v1/` → Go server (Connect-RPC) + TS-клиент через `make gen-proto`. Новый: `google_calendar.proto`. Расширены: `intelligence.proto` (Goal CRUD + InterviewSession + Milestones + NodeCoverage + Memory list/delete), `mock.proto` (RunAlgoAttempt + RunCodingAttempt + RunSysDesignAttempt + RunBehavioralAttempt), `subscription.proto` (GetTier + BYOK + CreateCheckoutSession + CancelSubscription), `tutor.proto` (Reading paths).
- **~70 страниц в `frontend/`** (web): /today (enriched), /atlas, /mock/{pipeline,diagnostic}, /codex, /podcasts, /tutor dashboard, /onboarding, /insights, /profile (+/memory +/settings), /whiteboard/:id, /editor/:id, и т.д.
- **~13 страниц в `hone/`** (focus cockpit): Today, Focus, Notes (Vault 🔒 + AI backlinks), Coach (Goal chip), TaskBoard (archive drawer + drag-ghost + inline-edit), Stats, Settings, EnglishOverview (Reading/Writing/Listening), Calendar, TutorAssignments. **Удалены 2026-05-12:** SharedBoards/Editor (→ web solo), Podcasts (→ web). Hone теперь pure focus cockpit.
- **Cue (`cue/`)** — tray-only, native Swift binary под macOS audio. **F10 ingest live:** session.end → backend intelligence service POST → coach memory.
- **94 миграции (`backend/migrations/`)** — consolidated baseline + ~80 patch'ей. Текущий последний — 00096 (goal_presets). Marathon 2026-05-12: 00083-00096 (14 migrations). См [README](../../backend/migrations/README.md). Создавай новые через `make migrate-new NAME=<snake_name>`.

## Где что

```
druzya/
├── proto/druz9/v1/           Контракт API (~27 .proto). Источник правды
├── backend/
│   ├── cmd/monolith/         Точка входа. Вся wiring здесь
│   ├── services/             Доменные сервисы (~25 шт)
│   ├── shared/               Общие пакеты: pkg/{llmchain,llmcache,quota,...}
│   │   └── generated/pb/     Генерированные Go-стубы
│   └── migrations/           Goose SQL миграции
├── frontend/                 Web (Vite + React + TS)
│   └── src/api/generated/    Генерированные TS-стубы (Connect-ES)
├── hone/                     Focus cockpit (Electron + Vite + React)
├── cue/                      Cue (Electron + Vite + React + Swift binary)
├── infra/                    docker-compose.prod, nginx, monitoring, deploy.sh
├── docs/
│   ├── feature/              Каноническая identity (identity.md)
│   └── tech/                 ← вы здесь
└── .ai/skills/               Project-specific skills для Claude
```

## Общие правила

- **Free-only LLM.** Все провайдеры — бесплатные tier'ы (Groq / Cerebras / Mistral / OpenRouter / Ollama). См [conventions.md §LLM](./conventions.md#llm-провайдеры).
- **Monorepo, не полирепо.** `go.work` собирает все сервисы. Frontend/Hone/Cue имеют свои `package.json`.
- **Connect-RPC, не gRPC и не REST.** Один транспорт, браузер ходит через `fetch`.
- **Generated файлы коммитятся.** CI ловит drift через `make gen-check`.
- **Никогда не amending published commits.** История чистая.

См [conventions.md](./conventions.md) для деталей.

## Smoke test для нового контрибутора

Проверяет, что dev-стек поднимается и базовые сценарии работают. < 30 минут от чистого клона.

```bash
# 1. Backend up (postgres + redis + minio + clickhouse + judge0 + api)
make start

# 2. Web frontend up (Vite + MSW моки)
make front

# 3. Smoke check — backend health + SPA routes + index.html mount
bash frontend/scripts/smoke.sh

# 4. Critical onboarding path (/welcome → /diagnostic → localStorage)
bash frontend/scripts/onboarding-test.sh

# 5. Optional: a11y audit на main routes (axe-core через npx)
bash frontend/scripts/a11y-check.sh

# 6. Optional: Core Web Vitals в DevTools console
#    Открой http://localhost:5173/today, открой DevTools console,
#    переключись в фон/вернись — увидишь [CWV] LCP/INP/CLS/TTFB.
#    Метрики + recommendations см docs/tech/perf.md.
```

Если все три скрипта passed — dev-стек здоров, можно делать PR. Если что-то failed — читай ошибку в выводе скрипта (hint'ы в каждом ✗-блоке).

См [perf.md](./perf.md) (performance baseline) и [a11y.md](./a11y.md) (WCAG audit) для деталей.
