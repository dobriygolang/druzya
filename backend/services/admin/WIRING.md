# admin domain — cmd/monolith wiring

The admin domain does not edit `cmd/monolith/main.go` or
`cmd/monolith/server.go`. Paste the snippets below into those two files when
wiring the domain in.

The admin contract is the last MVP surface (bible §3.14). It is a CMS/ops
area — manage tasks, companies, dynamic config, review anticheat signals.
Read-heavy for dashboards + write for curators. Eight REST endpoints, no
WebSocket.

---

## 1. Imports to add to `cmd/monolith/main.go`

```go
import (
    adminApp    "druz9/admin/app"
    adminInfra  "druz9/admin/infra"
    adminPorts  "druz9/admin/ports"
)
```

`pool *pgxpool.Pool`, `rdb *redis.Client` and `log *slog.Logger` should
already be in scope.

## 2. Constructor block — after the Editor wiring block

```go
// ── Admin wiring ──────────────────────────────────────────────────────────
adminTasks       := adminInfra.NewTasks(pool)
adminCompanies   := adminInfra.NewCompanies(pool)
adminConfig      := adminInfra.NewConfig(pool)
adminAnticheat   := adminInfra.NewAnticheat(pool)
adminBroadcaster := adminInfra.NewRedisBroadcaster(rdb)

adminListTasksUC     := &adminApp.ListTasks{Tasks: adminTasks}
adminCreateTaskUC    := &adminApp.CreateTask{Tasks: adminTasks}
adminUpdateTaskUC    := &adminApp.UpdateTask{Tasks: adminTasks}
adminListCompaniesUC := &adminApp.ListCompanies{Companies: adminCompanies}
adminUpsertCompanyUC := &adminApp.UpsertCompany{Companies: adminCompanies}
adminListConfigUC    := &adminApp.ListConfig{Config: adminConfig}
adminUpdateConfigUC  := &adminApp.UpdateConfig{
    Config: adminConfig, Broadcaster: adminBroadcaster, Log: log,
}
adminListAnticheatUC := &adminApp.ListAnticheat{Anticheat: adminAnticheat}

adminServer := adminPorts.NewAdminServer(
    adminListTasksUC, adminCreateTaskUC, adminUpdateTaskUC,
    adminListCompaniesUC, adminUpsertCompanyUC,
    adminListConfigUC, adminUpdateConfigUC,
    adminListAnticheatUC,
    log,
)
```

## 3. Event subscriptions

**None.** The admin domain only reads/writes through HTTP. The Redis Pub/Sub
broadcaster fan-out on `dynconfig:cache` + `dynconfig:changed:{key}` is
outbound; subscribers live in other domains.

## 4. Composite server embed — `cmd/monolith/server.go`

Add alongside the Editor block:

```go
import adminPorts "druz9/admin/ports"

type compositeServer struct {
    apigen.Unimplemented
    // … existing …
    Admin   *adminPorts.AdminServer // ← new
}
```

And in the composite-server constructor:

```go
return &compositeServer{
    // … existing …
    Admin: adminServer, // ← new
}
```

## 5. Per-method forwarders in `cmd/monolith/server.go`

```go
// ── admin ──────────────────────────────────────────────────────────────────

func (s *compositeServer) GetAdminTasks(w http.ResponseWriter, r *http.Request, params apigen.GetAdminTasksParams) {
    s.Admin.GetAdminTasks(w, r, params)
}
func (s *compositeServer) PostAdminTasks(w http.ResponseWriter, r *http.Request) {
    s.Admin.PostAdminTasks(w, r)
}
func (s *compositeServer) PutAdminTasksTaskId(w http.ResponseWriter, r *http.Request, taskId openapi_types.UUID) {
    s.Admin.PutAdminTasksTaskId(w, r, taskId)
}
func (s *compositeServer) GetAdminCompanies(w http.ResponseWriter, r *http.Request) {
    s.Admin.GetAdminCompanies(w, r)
}
func (s *compositeServer) PostAdminCompanies(w http.ResponseWriter, r *http.Request) {
    s.Admin.PostAdminCompanies(w, r)
}
func (s *compositeServer) GetAdminConfig(w http.ResponseWriter, r *http.Request) {
    s.Admin.GetAdminConfig(w, r)
}
func (s *compositeServer) PutAdminConfigKey(w http.ResponseWriter, r *http.Request, key string) {
    s.Admin.PutAdminConfigKey(w, r, key)
}
func (s *compositeServer) GetAdminAnticheat(w http.ResponseWriter, r *http.Request, params apigen.GetAdminAnticheatParams) {
    s.Admin.GetAdminAnticheat(w, r, params)
}
```

## 6. go.work

If the monolith's `go.work` does not already include admin, add:

```
use ./services/admin
```

## 7. Role enforcement

Every admin endpoint requires `role=admin`. The role is injected by the
existing `requireAuth` middleware in `cmd/monolith/main.go` — no extra
middleware is needed on the admin routes. The server itself (in
`ports/server.go::requireAdmin`) returns `403 forbidden` for non-admin
callers; unauthenticated callers still see `401 unauthorized` from the route
middleware before reaching the admin server.

The `solution_hint` field on tasks is normally forbidden from API responses.
Admin is the single legitimate exception (bible §3.14): curators need to
author + review the hint. The role gate is the load-bearing guard — see the
package doc-comment in `ports/server.go`.

## 8. STUBs

- **Audit log** — `UpdateConfig` stamps `updated_at` / `updated_by` on the
  row but there is no append-only history table yet. Deeper forensic
  questions currently go through PG point-in-time recovery.
- **Task CSV import** — flagged in `app/update_task.go`; a bulk-seed flow
  for curators is planned but not wired.
- **Anticheat bulk actions** — flagged in `app/list_anticheat.go`; curators
  eyeball the dashboard and act through per-row endpoints in each domain.
- **Company `sections` write path** — `CompanyUpsert` in openapi does not
  expose `sections`; the `UpsertCompany` sqlc query preserves whatever is
  already stored. When the contract evolves the SQL will need to be updated.

## 9. Sanity check

```bash
make gen-sqlc
cd backend/services/admin && go generate ./domain/...
cd backend/services/admin && go build ./... && go test -race ./domain/...
```

All three must be green after the wiring PR.
