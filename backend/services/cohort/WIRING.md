# Cohort domain — cmd/monolith wiring

The cohort domain does not edit `cmd/monolith/main.go` or `cmd/monolith/server.go`.
Paste the snippets below into those files when wiring the domain in.

## 1. Imports to add to `cmd/monolith/main.go`

```go
import (
    cohortApp    "druz9/cohort/app"
    cohortDomain "druz9/cohort/domain"
    cohortInfra  "druz9/cohort/infra"
    cohortPorts  "druz9/cohort/ports"
)
```

`log/slog` and `bus` (sharedDomain.Bus) should already be in scope.

## 2. Constructor calls (in `main()` after Postgres/Bus/Logger are built)

Assumes `pool *pgxpool.Pool`, `bus sharedDomain.Bus` and `log *slog.Logger`
are already in scope.

```go
// --- cohort ---
cohortPG     := cohortInfra.NewPostgres(pool)
cohortJudge0 := cohortInfra.NewFakeJudge0() // STUB — swap for real Judge0 client
cohortClock  := cohortDomain.RealClock{}

cohortMyCohort := &cohortApp.GetMyCohort{
    Cohorts: cohortPG, Wars: cohortPG, Clock: cohortClock,
}
cohortGet := &cohortApp.GetCohort{
    Cohorts: cohortPG, Wars: cohortPG, Clock: cohortClock,
}
cohortWar := &cohortApp.GetWar{
    Cohorts: cohortPG, Wars: cohortPG, Clock: cohortClock,
}
cohortContribute := &cohortApp.Contribute{
    Cohorts: cohortPG, Wars: cohortPG, Judge0: cohortJudge0,
    GetWar: cohortWar, Clock: cohortClock, Log: log,
}

cohortOnMatch := &cohortApp.OnMatchCompleted{Cohorts: cohortPG, Log: log}

// Subscribe to arena.MatchCompleted so cohort can bump next-week seed.
cohortApp.SubscribeHandlers(bus, cohortOnMatch)

cohortServer := cohortPorts.NewCohortServer(
    cohortMyCohort, cohortGet, cohortWar, cohortContribute, log,
)
```

## 3. Event subscriptions

`cohortApp.SubscribeHandlers` (called above) registers:

- `arena.MatchCompleted` → `cohortOnMatch.HandleMatchCompleted`

Future subscribers (spectator / raid events) should be added to
`services/cohort/app/handlers.go::SubscribeHandlers`, not here.

## 4. Composite server embed line in `cmd/monolith/server.go`

```go
type compositeServer struct {
    apigen.Unimplemented
    Auth    *authPorts.AuthServer
    Profile *profilePorts.ProfileServer
    Daily   *dailyPorts.DailyServer
    Rating  *ratingPorts.RatingServer
    Arena   *arenaPorts.ArenaServer
    Mock    *aimockPorts.MockServer
    Notify  *notifyPorts.NotifyServer
    Cohort   *cohortPorts.CohortServer // ← add this
}
```

And in the constructor:

```go
return &compositeServer{
    Auth:    authServer,
    Profile: profileServer,
    Daily:   dailyServer,
    Rating:  ratingServer,
    Arena:   arenaServer,
    Mock:    mockServer,
    Notify:  notifyServer,
    Cohort:   cohortServer, // ← add this
}
```

## 5. Per-method forwarders in `cmd/monolith/server.go`

```go
// ── cohort ──────────────────────────────────────────────────────────────────

func (s *compositeServer) GetCohortMy(w http.ResponseWriter, r *http.Request) {
    s.Cohort.GetCohortMy(w, r)
}
func (s *compositeServer) GetCohortCohortId(w http.ResponseWriter, r *http.Request, cohortId openapi_types.UUID) {
    s.Cohort.GetCohortCohortId(w, r, cohortId)
}
func (s *compositeServer) GetCohortCohortIdWar(w http.ResponseWriter, r *http.Request, cohortId openapi_types.UUID) {
    s.Cohort.GetCohortCohortIdWar(w, r, cohortId)
}
func (s *compositeServer) PostCohortCohortIdWarContribute(w http.ResponseWriter, r *http.Request, cohortId openapi_types.UUID) {
    s.Cohort.PostCohortCohortIdWarContribute(w, r, cohortId)
}
```

## 6. go.work

If the monolith's `go.work` does not already include cohort, add:

```
use ./services/cohort
```

## Notes & STUBs

- `cohortInfra.FakeJudge0` — swap for real Judge0 client once available.
- `OnMatchCompleted.Apply` logs a "seedBump (STUB)" — replace with a real
  next-week seed bump when season pairing lands.
- Contributions are stored **in-memory** in `cohortInfra.Postgres` because
  migration 00005 has no `cohort_war_contributions` table. The JSONB score map
  on `cohort_wars` is the source of truth for the visible tally.
- There is no shared `CohortWarLineScoreUpdated` event yet — the Contribute use
  case logs a LOCAL marker instead of publishing, per the scope guidance.
