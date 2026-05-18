# mock_interview — wiring

Multi-stage mock interview service: companies, ai_strictness_profiles,
mock_tasks + task_questions, stage_default_questions, company_questions,
company_stages, mock_pipelines + pipeline_stages + pipeline_attempts.

## Layout

```
domain/        entities, enums, repo interfaces, errors
app/           use cases (companies, strictness, tasks, questions,
               company_stages, pipelines, orchestrator, graders, replay)
infra/         pgx adapters — one file per resource family + jsonb helper
ports/         chi + Connect-RPC handlers, requireAdmin / requireUser
               gates, DTOs
```

## Surfaces

- Admin CRUD over the 9 resource tables, mounted under `/api/v1/admin/mock/*`
  with the `requireAdmin` (role=admin claim) gate.
- Public `/api/v1/mock/companies` (list active) — used by the `/mock` picker.
- Public `/api/v1/mock/pipelines` (POST create, GET by id, GET list) +
  orchestrator endpoints (StartNextStage, SubmitAnswer, FinishStage,
  CancelPipeline, AttemptFinalised).
- Stage-specific graders (RunAlgo, RunCoding, RunSysDesign, RunBehavioral)
  for the iterative «Run rubric» knob — distinct from the canonical
  SubmitAnswer grade path.
- Post-debrief replay (GET / POST) — LLM-generated ideal answer + diff
  annotations.
- `ResolveStrictness(taskID, companyID, stage)` cascade lookup
  (task → company_stage → global `default`).

## Wiring notes for bootstrap

`backend/cmd/monolith/services/mock_interview.go` constructs every repo,
the `app.Handlers` aggregate, the `app.Orchestrator`, and the
`ports.Server`. The Module mounts chi handlers under `/api/v1/admin/mock/*`
and `/api/v1/mock/*`; Connect-RPC handlers are registered against the
vanguard transcoder on the same paths.

Routes mount under the gated `/api/v1` chain (bearer auth required); the
`requireAdmin` / `requireAdminConnect` second-tier gate lives inside the
handler itself.

## Dependencies

- `druz9/shared` — `pkg/pg.UUID`/`UUIDFrom` helpers, `pkg/middleware`
  context accessors, `pkg/llmchain` for LLM calls,
  `pkg/userlocale` for response-language resolution.
- `github.com/jackc/pgx/v5` directly (no sqlc).
- `github.com/go-chi/chi/v5` for routing.
- `connectrpc.com/connect` for typed RPC.

No cross-service imports. `mock_pipelines.user_id` references `users(id)`
in the database but the service does not import any other Go package to
verify; the FK constraint is the source of truth.
