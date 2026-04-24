# hone service

Backend for **Hone**, the desktop focus cockpit. See:

- [../../../hone-bible.md](../../../hone-bible.md) — product spec, MVP scope
- [../../../ecosystem.md](../../../ecosystem.md) — how Hone fits with druz9 web and Cue
- [`../../../proto/druz9/v1/hone.proto`](../../../proto/druz9/v1/hone.proto) — wire contract

## Layout

```
hone/
├── domain/       entities, repo interfaces, enums, errors — no framework imports
├── app/          use cases (plan/focus/notes/whiteboard); wiring-agnostic
├── infra/        Postgres repos, embedding wrapper, llmchain adapter
│   ├── pg/       hand-rolled pgx queries (sqlc can wrap later if they stabilise)
│   └── queries/  *.sql source for sqlc (when we switch)
└── ports/        Connect-RPC handlers (server.go) + converters
```

## Status (skeleton)

MVP skeleton committed. Every file is marked with `// STUB:` at the points
that need real logic. The service compiles (once proto is generated + wired
into go.work) and each RPC returns `codes.Unimplemented` so the monolith
boots. Fill in:

1. `app/plan_generator.go` — LLM call via `llmchain.TaskDailyPlanSynthesis`
2. `app/note_store.go` — embedding + cosine search
3. `infra/pg/*.go` — real queries (currently hand-rolled STUBs)
4. `app/focus_session.go` — streak transition logic

## Domain boundaries

- `hone` NEVER imports from other services directly. Cross-domain signals
  travel through `shared/domain/events.go` (XPGained, FocusSessionEnded,
  etc.). Adapter pattern — `SkillAtlasReader` interface owned by `hone`
  and implemented in `monolith/services/adapters.go` against profile's
  repo.
- `hone` never stores task/arena/mock content — only references
  (target_ref on PlanItem). The client deep-links to druz9.ru.
