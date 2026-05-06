# hone service

Backend for **Hone**, the desktop focus cockpit. See:

- [../../../docs/for_investment/hone.md](../../../docs/for_investment/hone.md) — product spec
- [../../../docs/for_investment/ecosystem.md](../../../docs/for_investment/ecosystem.md) — how Hone fits with druz9 web and Cue
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

## Status

Production. Daily plan synthesis (LLM via `llmchain.TaskDailyPlanSynthesis`),
note store with embedding + cosine search, real pg queries, focus session
streak logic, English grader (Reading/Writing/Listening) all wired.

## Domain boundaries

- `hone` NEVER imports from other services directly. Cross-domain signals
  travel through `shared/domain/events.go` (FocusSessionEnded, etc.).
  Adapter pattern — `SkillAtlasReader` interface owned by `hone` and
  implemented in `monolith/services/adapters.go` against profile's repo.
- `hone` never stores mock content — only references. The client deep-links
  to druz9.online for AI-mock / atlas / codex.
