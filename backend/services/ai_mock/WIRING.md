# ai_mock wiring cheat sheet

This file collects the exact snippets that need to be added to
`cmd/monolith/main.go` and `cmd/monolith/server.go` when ai_mock is switched on.
**Do not touch those two files in this PR** — they are stable, and this
document is the landing pad for whoever does the wiring PR.

---

## 1. Imports — `cmd/monolith/main.go`

```go
aimockApp   "druz9/ai_mock/app"
aimockInfra "druz9/ai_mock/infra"
aimockPorts "druz9/ai_mock/ports"
```

## 2. Constructor block — after the `// ── Rating wiring` block

```go
// ── AI Mock wiring
mockSessions := aimockInfra.NewSessions(pool)
mockMessages := aimockInfra.NewMessages(pool)
mockTasks    := aimockInfra.NewTasks(pool)
mockCompanies := aimockInfra.NewCompanies(pool)
mockUsers    := aimockInfra.NewUsers(pool)
mockLLM      := aimockInfra.NewOpenRouter(cfg.LLM.OpenRouterAPIKey)
mockReplay   := aimockInfra.NewStubReplayUploader(cfg.MinIO.Endpoint) // STUB
mockLimiter  := aimockInfra.NewRedisLimiter(rdb)

mockHub := aimockPorts.NewHub(log)

reportWorker := aimockApp.NewReportWorker(2, 64, log)
reportWorker.Sessions = mockSessions
reportWorker.Messages = mockMessages
reportWorker.Tasks    = mockTasks
reportWorker.LLM      = mockLLM
reportWorker.Replay   = mockReplay
reportWorker.Start(rootCtx)

createMock := &aimockApp.CreateSession{
    Sessions: mockSessions, Tasks: mockTasks, Users: mockUsers, Companies: mockCompanies,
    Bus: bus,
    DefaultModelFree: enums.LLMModel(cfg.LLM.DefaultModelFree),
    DefaultModelPaid: enums.LLMModel(cfg.LLM.DefaultModelPaid),
    Log: log, Now: now,
}
getMock := &aimockApp.GetSession{
    Sessions: mockSessions, Messages: mockMessages, Tasks: mockTasks,
    LastMessagesLimit: 20,
}
sendMock := &aimockApp.SendMessage{
    Sessions: mockSessions, Messages: mockMessages, Tasks: mockTasks,
    Users: mockUsers, Companies: mockCompanies,
    LLM: mockLLM, Limiter: mockLimiter, Log: log, Now: now,
}
stressMock := &aimockApp.IngestStress{
    Sessions: mockSessions,
    Emit: func(sid uuid.UUID, c aimockDomain.StressCrossing) {
        mockHub.BroadcastStressUpdate(sid, c)
    },
}
finishMock := &aimockApp.FinishSession{
    Sessions: mockSessions, Bus: bus, Worker: reportWorker, Log: log, Now: now,
}
reportMock := &aimockApp.GetReport{Sessions: mockSessions}

mockServer := aimockPorts.NewMockServer(createMock, getMock, sendMock, stressMock, finishMock, reportMock, log)

// WebSocket handler. TokenVerifier is satisfied by the auth package's
// tokenIssuer once it exposes a Verify(token) (uuid.UUID, error) method —
// today the auth domain has this inside authApp.TokenIssuer (see
// auth/app/token.go). Adapt with a tiny shim if the method name differs.
mockWS := aimockPorts.NewWSHandler(mockHub, tokenIssuer, mockSessions, mockMessages, sendMock, stressMock, log)
```

You'll need these extra imports in main.go:

```go
aimockDomain "druz9/ai_mock/domain"
"druz9/shared/enums"
"github.com/google/uuid"
```

## 3. Event subscriptions

AI Mock doesn't subscribe to any cross-domain events today — it only
**publishes** `mock.SessionCreated` and `mock.SessionFinished`. No entries to add
in the `// ── Cross-domain event subscriptions` block.

## 4. Composite server — `cmd/monolith/server.go`

Embed `*aimockPorts.MockServer` on `compositeServer` and add forwarders:

```go
import aimockPorts "druz9/ai_mock/ports"

type compositeServer struct {
    apigen.Unimplemented
    Auth    *authPorts.AuthServer
    Profile *profilePorts.ProfileServer
    Daily   *dailyPorts.DailyServer
    Rating  *ratingPorts.RatingServer
    Mock    *aimockPorts.MockServer // ← new
}

// ── mock ──────────────────────────────────────────────────────────────
func (s *compositeServer) PostMockSession(w http.ResponseWriter, r *http.Request) {
    s.Mock.PostMockSession(w, r)
}
func (s *compositeServer) GetMockSessionSessionId(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Mock.GetMockSessionSessionId(w, r, sessionId)
}
func (s *compositeServer) PostMockSessionSessionIdMessage(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Mock.PostMockSessionSessionIdMessage(w, r, sessionId)
}
func (s *compositeServer) PostMockSessionSessionIdStress(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Mock.PostMockSessionSessionIdStress(w, r, sessionId)
}
func (s *compositeServer) PostMockSessionSessionIdFinish(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Mock.PostMockSessionSessionIdFinish(w, r, sessionId)
}
func (s *compositeServer) GetMockSessionSessionIdReport(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Mock.GetMockSessionSessionIdReport(w, r, sessionId)
}
```

Then in `main.go` where the composite is constructed:

```go
srv := &compositeServer{
    Auth:    authServer,
    Profile: profileServer,
    Daily:   dailyServer,
    Rating:  ratingServer,
    Mock:    mockServer, // ← new
}
```

## 5. WebSocket route

Register BEFORE `apigen.HandlerFromMux` mounts — websockets should not go
through the gated `requireAuth` middleware (they auth via `?token=`).

Add to `main.go` inside the `r.Route("/api/v1", …)` block is wrong — ws lives
at the top level. In the chi router setup:

```go
// Outside /api/v1 — ws has its own query-token auth.
r.Get("/ws/mock/{sessionId}", mockWS.Handle)
```

## 6. Shutdown order

After `httpSrv.Shutdown`, before `pool.Close()`, drain the worker:

```go
reportWorker.Close()
reportWorker.Wait()
```

(The worker's goroutines already exit when `rootCtx` is cancelled by the
signal handler; `Close` just stops accepting new jobs and `Wait` blocks until
the current job finishes.)

## 7. Sanity check

```bash
make gen-sqlc
cd backend/services/ai_mock && go generate ./domain/...
go test -race ./...
```

All three steps must be green after the wiring PR.
