# Hone — Project Bible

> Minimal dark desktop focus cockpit для разработчика в экосистеме druz9.
> Версия 0.1 · apr 2026

---

## 1. Что это

Hone — десктоп-приложение для ежедневного роста программиста. Часть экосистемы druz9 (см [ecosystem.md](./ecosystem.md)). **Не заменяет druz9.ru** — оборачивает его в тихий фокус-слой для работы over the day.

**Аудитория:** middle/senior разработчик в РФ, готовится к собесу и/или хочет расти каждый день. Устал от Notion + Todoist + Leetcode + Obsidian + Cal.

**One-liner:** «Sharpen your craft daily. Quietly.»

---

## 2. ДНК продукта

- **Winter-эстетика:** один чёрный canvas, панели выезжают по ⌘K, Esc возвращает в пустоту.
- **Keyboard-first:** всё через палитру, никаких меню.
- **AI везде где имеет смысл** (плавно, не навязчиво).
- **Приватность:** Notes/Whiteboard живут локально + E2E sync, никогда не расшариваются.
- **Radical minimalism:** если на экране больше 2 визуальных групп — режем.

---

## 3. Модули MVP

| Модуль | Хоткей | Что делает | AI-угол | Reuse из druz9 |
|---|---|---|---|---|
| Canvas (home) | — | Медитативный фон + timer в центре внизу | — | — |
| Today | `T` | AI-план дня, 3-4 пункта | Skill Atlas + calendar + GitHub → plan | `services/profile`, `llmchain` |
| Focus | `F` | Pomodoro + pinned task | — | — |
| Notes | `N` | Markdown + AI-connections | embeddings → auto-links с PR/tasks | `llmcache` (bge-small) |
| Whiteboard | `D` | Excalidraw-like + AI-critic | `SysDesignCritique` task в llmchain | `llmchain` |
| Stats | `S` | Focus heatmap + streak + 7d bars | — | — |
| Stealth | `⌘⇧Space` | tray overlay, невидим для screen-share | вся llmchain | `desktop/` as-is |
| Palette | `⌘K` | единый вход ко всему | — | — |

---

## 4. Что Hone НЕ делает (hard cuts)

- ❌ Не решает задачи — deep-link на druz9.ru
- ❌ Нет Arena, mock, guild, рейтинга, турниров
- ❌ Нет full Skill Atlas viz (показывает только «твоё слабое место на сегодня»)
- ❌ Нет магазина / продажи Pro (ссылка на druz9.ru/pricing)
- ❌ В MVP нет Calendar интеграции, recordings, collab

---

## 5. Архитектура

### Frontend (Electron)

```
desktop/src/renderer/
├── screens/
│   ├── hone/                   NEW main window
│   │   ├── Canvas.tsx          root меditative фон (waveforms, stars, timer)
│   │   ├── panels/
│   │   │   ├── Today.tsx
│   │   │   ├── Focus.tsx
│   │   │   ├── Notes.tsx
│   │   │   ├── Whiteboard.tsx
│   │   │   └── Stats.tsx
│   │   ├── palette/
│   │   │   └── CommandPalette.tsx
│   │   └── store/              zustand
│   ├── compact/                EXISTING stealth (не трогаем)
│   ├── expanded/               EXISTING stealth
│   └── ...                     onboarding, settings
└── shared/
    └── druz9Client.ts          Connect-RPC клиент (есть)
```

### Backend — один новый сервис `services/hone/`

```
backend/services/hone/
├── app/
│   ├── plan_generator.go       AI-плановщик (Today)
│   ├── focus_session.go        pomodoro logs, streak calc
│   ├── note_store.go           markdown + embedding + autolink
│   └── whiteboard_store.go     tldraw state persist
├── domain/
│   ├── focus.go                FocusSession, PomodoroRound
│   ├── note.go                 Note + Connection
│   └── whiteboard.go           WhiteboardDoc
├── infra/
│   ├── pg/                     sqlc queries
│   └── embed/                  wrapper над llmcache для bge-small
├── ports/connect/              RPC handlers
└── README.md
```

### Миграции

- `00047_hone_focus_sessions.sql` — focus_session, pomodoro_round, streak_day
- `00048_hone_notes.sql` — note, note_embedding (pgvector), note_connection
- `00049_hone_whiteboards.sql` — whiteboard_doc, whiteboard_version

### Proto (`proto/druz9/v1/hone.proto`)

```protobuf
service HoneService {
  rpc GenerateDailyPlan(GenerateDailyPlanReq) returns (Plan);
  rpc StartFocusSession(StartFocusReq) returns (FocusSession);
  rpc EndFocusSession(EndFocusReq) returns (FocusSession);
  rpc GetStats(GetStatsReq) returns (Stats);

  rpc CreateNote(Note) returns (Note);
  rpc UpdateNote(Note) returns (Note);
  rpc SearchNotes(SearchReq) returns (stream Note);
  rpc GetNoteConnections(NoteId) returns (stream Connection);

  rpc CreateWhiteboard(Whiteboard) returns (Whiteboard);
  rpc UpdateWhiteboard(Whiteboard) returns (Whiteboard);
  rpc CritiqueWhiteboard(WhiteboardId) returns (stream CritiquePacket);
}
```

### AI integration

Все AI-вызовы через существующий `backend/shared/pkg/llmchain/`:

- Today plan → новый task **`DailyPlanSynthesis`** в `TaskModelMap` (routing: groq → mistral → openrouter → ollama)
- Note auto-link → embedding через `llmcache` Ollama `bge-small-en-v1.5` (есть)
- Whiteboard critique → existing `SysDesignCritique` task (есть)
- Ничего нового в llmchain кроме одного task entry

---

## 6. Sync с druz9.ru

| Поток | Направление |
|---|---|
| Skill Atlas (слабые навыки) | web → Hone (read) |
| Current focus-time today | Hone → web (write) |
| Streak days | Hone → web (write) |
| Открыть задачу | Hone → браузер (deep link `druz9://task/...`) |
| Старт focus из web | web → Hone (deep link `druz9://focus/start?...`) |
| Notes / Whiteboard | **НЕ синкается с web** — приватно |

---

## 7. Roadmap MVP

| Фаза | Срок | Что |
|---|---|---|
| 0. Дизайн | 1-2 нед | Pencil: все панели + canvas, финал палитры |
| 1. Shell | 2 нед | Canvas, ⌘K палитра, Pomodoro UI, Stats (mock data) |
| 2. Backend | 2 нед | миграции, `services/hone`, proto, sqlc, тесты |
| 3. Today + Notes | 2 нед | AI-planner, markdown-editor, embedding auto-link |
| 4. Whiteboard | 1 нед | tldraw + AI-critique stream |
| 5. Stealth wiring | 1 нед | единая точка входа (tray + main window) |
| 6. Beta | 1 нед | 50 юзеров из druz9 audience |

**Public v1 ≈ 10 недель от начала дизайна.**

---

## 8. Pricing

- **Free:** Canvas, Pomodoro, Notes без AI, Stats, Whiteboard без AI.
- **Pro (через `druz9 Pro`):** AI-planner, AI-connections, AI-critique, Stealth copilot.

Единая подписка с web — не отдельная.

---

## 9. Метрики v1

- D1 retention ≥ 40% (установили → вернулись на следующий день)
- D7 retention ≥ 20%
- Ежедневный focus-session старт ≥ 1 раз для активных пользователей
- Stealth-вызов ≥ 3 раз в неделю для Pro

---

## 10. Parking lot (не в MVP)

- Calendar интеграция (Google / Яндекс)
- Voice recordings + speech-to-text
- Collab notes / shared whiteboard
- iOS / Android companion
- Windows / Linux билд (только macOS в v1)
- Light theme (только dark в v1)
- Integrations: Linear, Jira, Notion

## 11. Backend-дыры, которые не открылись к v1

Зафиксировано 2026-04-24 после Phase 4. Всё компилируется, тесты зелёные, но
эти хвосты стоит держать на радаре — ни один не блокирует публичный v1.

- **Keyset cursor pagination для Notes.List** — сейчас отдаём первые 100 по
  `updated_at DESC`, cursor игнорируется. Превратится в проблему когда у
  кого-то накопится >100 заметок; для MVP (средний юзер ~10-50) ОК.
- **Cross-domain connections для заметок** — `GetNoteConnections` сканирует
  только note-to-note corpus. Следующий шаг: PR-edges через GitHub-activity
  таблицу, task-edges через `daily_kata_history`, session-edges через
  ai_mock. Нужна единая "artefact с embedding" таблица — отдельная миграция.
- **Embedding async worker → proper queue** — сейчас `go uc.EmbedFn(...)`
  fire-and-forget. При рестарте монолита inflight-эмбеддинги теряются.
  Перевести на Redis-list или Postgres-NOTIFY когда корпус вырастет.
- **Streak reconciliation background job** — `EndFocus` игнорирует ошибку
  `ApplyFocusSession` (сессия сохранена, streak может задрейфовать). Нужен
  периодический worker который пересчитывает `hone_streak_days` и
  `hone_streak_state` из факта `hone_focus_sessions` за последние N дней.
- **Rate limit на `GenerateDailyPlan`** — юзер может спамить `force=true` и
  жечь LLM-квоту. Добавить per-user token bucket (1 regenerate / 5 минут)
  через существующий `shared/pkg/ratelimit`.
- **Domain mocks (mockgen)** — `domain/repo.go` имеет `go:generate` директиву,
  но папки `mocks/` пока нет. Сейчас app-тесты используют hand-rolled fakes;
  когда таблица интерфейсов стабилизируется, запустить mockgen и переписать
  на gomock как в daily.
