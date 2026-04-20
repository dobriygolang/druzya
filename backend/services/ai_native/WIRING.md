# ai_native wiring cheat sheet

This file collects the exact snippets that need to be added to
`cmd/monolith/main.go` and `cmd/monolith/server.go` when ai_native is switched on.
**Do not touch those two files in this PR** — they are stable, and this
document is the landing pad for whoever does the wiring PR.

---

## 1. Imports — `cmd/monolith/main.go`

```go
ainativeApp   "druz9/ai_native/app"
ainativeInfra "druz9/ai_native/infra"
ainativePorts "druz9/ai_native/ports"
```

You'll also want (if not already imported by the monolith):

```go
ainativeDomain "druz9/ai_native/domain"
"druz9/shared/enums"
```

## 2. Constructor block — after the `// ── AI Mock wiring` block

```go
// ── AI Native wiring (bible §19.1)
nativeSessions    := ainativeInfra.NewSessions(pool)
nativeProvenance  := ainativeInfra.NewProvenance(pool)
nativeTasks       := ainativeInfra.NewTasks(pool)
nativeUsers       := ainativeInfra.NewUsers(pool)
nativeLLM         := ainativeInfra.NewOpenRouter(cfg.LLM.OpenRouterAPIKey)
nativeTraps       := ainativeInfra.NewStaticTrapStore()

createNative := &ainativeApp.CreateSession{
    Sessions: nativeSessions, Tasks: nativeTasks, Users: nativeUsers,
    DefaultModelFree: enums.LLMModel(cfg.LLM.DefaultModelFree),
    DefaultModelPaid: enums.LLMModel(cfg.LLM.DefaultModelPaid),
    Log: log, Now: now,
}
submitNative := &ainativeApp.SubmitPrompt{
    Sessions: nativeSessions, Provenance: nativeProvenance,
    Tasks: nativeTasks, Users: nativeUsers,
    LLM: nativeLLM, Traps: nativeTraps,
    Policy: ainativeDomain.DefaultTrapPolicy(),
    Scoring: ainativeDomain.DefaultScoring(),
    Log: log,
}
verifyNative  := &ainativeApp.Verify{
    Sessions: nativeSessions, Provenance: nativeProvenance,
    Scoring: ainativeDomain.DefaultScoring(), Log: log,
}
getProvNative := &ainativeApp.GetProvenance{
    Sessions: nativeSessions, Provenance: nativeProvenance,
}
getScoreNative := &ainativeApp.GetScore{Sessions: nativeSessions}
finishNative   := &ainativeApp.Finish{
    Sessions: nativeSessions, Provenance: nativeProvenance,
    Bus: bus, Scoring: ainativeDomain.DefaultScoring(), Log: log, Now: now,
}

nativeServer := ainativePorts.NewNativeServer(
    createNative, submitNative, verifyNative,
    getProvNative, getScoreNative, finishNative, log,
)
```

Notes:

- `ai_native` has its OWN `LLMProvider` interface and its OWN OpenRouter client
  — do not reuse the `ai_mock` one. Keeps the bounded contexts independent.
- `SubmitPrompt` accepts any `domain.LLMProvider`. If you want the decorator
  trap-injection flow (instead of letting `SubmitPrompt.Do` orchestrate the
  substitution directly), wrap the client:

  ```go
  nativeLLMDecorated := ainativeInfra.NewTrapInjector(nativeLLM, nativeTraps, func(req ainativeDomain.CompletionRequest) (string, bool) {
      // decide per request; section can be passed via ContextCode prefix or a
      // separate tag in future iterations.
      return "", false
  })
  submitNative.LLM = nativeLLMDecorated
  ```

## 3. Event subscriptions

AI Native doesn't subscribe to any cross-domain events today — it only
**publishes** `native.RoundFinished` on `Finish.Do`. No entries to add
in the `// ── Cross-domain event subscriptions` block.

## 4. Composite server — `cmd/monolith/server.go`

Embed `*ainativePorts.NativeServer` on `compositeServer` and add forwarders:

```go
import ainativePorts "druz9/ai_native/ports"

type compositeServer struct {
    apigen.Unimplemented
    // existing fields …
    Native *ainativePorts.NativeServer // ← new
}

// ── native ────────────────────────────────────────────────────────────
func (s *compositeServer) PostNativeSession(w http.ResponseWriter, r *http.Request) {
    s.Native.PostNativeSession(w, r)
}
func (s *compositeServer) PostNativeSessionSessionIdPrompt(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Native.PostNativeSessionSessionIdPrompt(w, r, sessionId)
}
func (s *compositeServer) PostNativeSessionSessionIdVerify(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Native.PostNativeSessionSessionIdVerify(w, r, sessionId)
}
func (s *compositeServer) GetNativeSessionSessionIdProvenance(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Native.GetNativeSessionSessionIdProvenance(w, r, sessionId)
}
func (s *compositeServer) GetNativeSessionSessionIdScore(w http.ResponseWriter, r *http.Request, sessionId openapi_types.UUID) {
    s.Native.GetNativeSessionSessionIdScore(w, r, sessionId)
}
```

Then in `main.go` where the composite is constructed:

```go
srv := &compositeServer{
    // existing fields …
    Native: nativeServer, // ← new
}
```

## 5. Shutdown order

Nothing to do. `ai_native` has no background goroutines, no workers and no
subscriptions. All I/O is request-scoped; the existing `httpSrv.Shutdown`
drain is sufficient.

## 6. Sanity check

```bash
cd backend && go run github.com/sqlc-dev/sqlc/cmd/sqlc generate
cd backend/services/ai_native && go generate ./domain/...
cd backend/services/ai_native && go build ./... && go test -race -count=1 ./domain/...
```

All three steps must be green after the wiring PR.

## 7. Known STUBs

Listed so the future curator knows what to come back to:

- `infra/traps.go` — hallucination-trap catalog is hardcoded; a migration
  turning it into a CMS-driven table is tracked in bible §19.1.
- `app/handlers.go` — cross-session analytics aggregator is not built.
- replay integration (reusing ai_mock's MinIO uploader) is not wired —
  ai_native rounds do not currently produce a replay.
