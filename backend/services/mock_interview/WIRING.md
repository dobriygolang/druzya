# mock_interview — Phase A wiring

Phase A of ADR-002 (mock-interview as the killer feature). This service
owns the multi-stage mock interview data model: companies (extended),
ai_strictness_profiles, mock_tasks + task_questions,
stage_default_questions, company_questions, company_stages, mock_pipelines
+ pipeline_stages + pipeline_attempts.

## Layout

```
domain/        entities, enums, repo interfaces, errors
app/           use cases (companies, strictness, tasks, questions,
               company_stages, pipelines)
infra/         pgx adapters — one file per resource family + jsonb helper
ports/         chi REST server, requireAdmin / requireUser gates, DTOs
```

## In scope (Phase A)

- Admin CRUD over the 9 new tables. All admin routes mount under
  `/api/v1/admin/mock/*` and use `requireAdmin` (role=admin claim).
- Public `/api/v1/mock/companies` (list active) — used by the `/mock`
  picker.
- Public `/api/v1/mock/pipelines` (POST create, GET by id, GET list).
  POST replaces the frontend's `coming_soon` gate. The handler creates
  the `mock_pipelines` row plus a `pipeline_stages` skeleton derived from
  `company_stages` (or a default 5-stage skeleton in random mode).
- `Resolve(taskID, companyID, stage)` cascade lookup for
  `ai_strictness_profiles` (task → company_stage → global `default`).
  Exposed on the Handlers struct for future orchestrator use.

## Out of scope (Phase A → moved to Phase B)

- **Orchestrator**: stage advancement, AI-judge invocation, task picking
  from `task_pool_ids`, attempt scoring. `CreatePipeline` only allocates
  rows.
- **Connect-RPC / proto**: ~30 RPCs for the admin surface would force a
  large proto regen ahead of stable shapes. Phase A keeps everything as
  chi-direct REST. When orchestrator UX stabilises in Phase B, we'll
  promote to proto in one batch.
- **sqlc**: hand-rolled pgx is enough for v1. Adding sqlc.yaml entries
  here would diverge from the rest of the workspace's adoption gradient
  (services/admin and services/circles also hand-roll pgx).
- **Admin UI**: handled by the frontend admin scaffold task — this
  package only ships the API.

## Wiring notes for bootstrap

`backend/cmd/monolith/services/mock_interview.go` constructs every repo,
the `app.Handlers` aggregate, and the `ports.Server`. The Module exposes
only `MountREST` — there is no Connect mount in Phase A.

Routes mount under the gated `/api/v1` chain (bearer auth required); the
`requireAdmin` second-tier gate lives inside the handler itself, mirroring
the convention already used by `services/admin`.

## Dependencies

- `druz9/shared` — `pkg/pg.UUID`/`UUIDFrom` helpers, `pkg/middleware`
  context accessors.
- `github.com/jackc/pgx/v5` directly (no sqlc).
- `github.com/go-chi/chi/v5` for routing.

No cross-service imports. `mock_pipelines.user_id` references `users(id)`
in the database but the service does not import any other Go package to
verify; the FK constraint is the source of truth.

## Phase B follow-ups

- Orchestrator service (advance stages, pick tasks, drive judge).
- Promote shapes to proto + Connect once orchestrator UX settles.
- Wire `ResolveStrictness` into the judge prompt builder.
- Decide whether to add sqlc when the query surface grows past ~30
  hand-rolled SELECTs.
- Frontend FE shapes (`MockCompany.level/tier/default_languages`) drift
  from the BE shape — Phase B should reconcile during the FE admin
  scaffold pass.
