# Arena domain — cmd/monolith wiring

The arena domain does not edit `cmd/monolith/main.go` or `cmd/monolith/server.go`.
Paste the snippets below into those files when wiring the domain in.

## 1. Imports to add to `cmd/monolith/main.go`

```go
import (
    arenaApp   "druz9/arena/app"
    arenaInfra "druz9/arena/infra"
    arenaPorts "druz9/arena/ports"
    arenaDomain "druz9/arena/domain"
)
```

You will already have these in scope — only add what is missing:

```go
import (
    "druz9/shared/enums"
    sharedDomain "druz9/shared/domain"
    "github.com/google/uuid"
)
```

## 2. Constructor calls (in `main()` after Postgres/Redis/Bus/Logger are built)

Assumes `pool *pgxpool.Pool`, `rdb *redis.Client`, `bus sharedDomain.Bus`,
`log *slog.Logger`, `tokenIssuer *authApp.TokenIssuer`, and `ratingRepo` (any
type exposing a per-(user,section) ELO lookup) are already in scope.

```go
// --- arena ---
arenaPG     := arenaInfra.NewPostgres(pool)
arenaRedis  := arenaInfra.NewRedis(rdb)
arenaJudge0 := arenaInfra.NewFakeJudge0() // STUB — swap for real client

// A small adapter around the auth TokenIssuer so the WS hub can verify tokens
// without importing the auth package directly:
arenaVerifier := tokenVerifierAdapter{issuer: tokenIssuer}

// Allowed origins for WS handshake — comma-separated env or []string{} in dev.
arenaWS := arenaPorts.NewHub(log, arenaVerifier, strings.Split(os.Getenv("WS_ALLOWED_ORIGINS"), ","))

arenaClock := arenaDomain.RealClock{}

arenaFind    := &arenaApp.FindMatch{Queue: arenaRedis, Clock: arenaClock}
arenaCancel  := &arenaApp.CancelSearch{Queue: arenaRedis}
arenaGet     := &arenaApp.GetMatch{Matches: arenaPG, Tasks: arenaPG}
arenaConfirm := &arenaApp.ConfirmReady{
    Matches: arenaPG, Ready: arenaRedis, Bus: bus,
    Notifier: arenaWS, Clock: arenaClock, Log: log,
}
arenaTimeouts := &arenaApp.HandleReadyCheckTimeout{
    Queue: arenaRedis, Matches: arenaPG, Ready: arenaRedis,
    Bus: bus, Clock: arenaClock, Log: log,
}
arenaSubmit := &arenaApp.SubmitCode{
    Matches: arenaPG, Tasks: arenaPG, Judge0: arenaJudge0,
    Anticheat: arenaRedis, Bus: bus, Clock: arenaClock, Log: log,
}
arenaPaste := &arenaApp.OnPasteAttempt{Anticheat: arenaRedis, Bus: bus}
arenaTab   := &arenaApp.OnTabSwitch{Anticheat: arenaRedis, Bus: bus}

// Hook WS anticheat inputs to use cases.
arenaWS.OnPaste = func(ctx context.Context, matchID, userID uuid.UUID) {
    _ = arenaPaste.Apply(ctx, matchID, userID)
}
arenaWS.OnTab = func(ctx context.Context, matchID, userID uuid.UUID) {
    _ = arenaTab.Apply(ctx, matchID, userID)
}

// ELO resolver — injected to avoid importing rating here. Use the rating
// domain's port directly if it's already in scope; this closure is the
// indirection.
arenaEloFn := arenaPorts.UserEloFunc(func(ctx any, userID uuid.UUID, section enums.Section) int {
    c, _ := ctx.(context.Context)
    if c == nil { c = context.Background() }
    list, err := ratingRepo.List(c, userID)
    if err != nil { return arenaDomain.InitialELO }
    for _, r := range list {
        if r.Section == section { return r.Elo }
    }
    return arenaDomain.InitialELO
})

arenaServer := arenaPorts.NewArenaServer(
    arenaFind, arenaCancel, arenaConfirm, arenaSubmit, arenaGet, arenaTimeouts,
    arenaEloFn, log,
)

// Matchmaker dispatcher — runs a 2s ticker goroutine until `stop` is called.
arenaMatchmaker := arenaApp.NewMatchmaker(
    arenaRedis, arenaRedis, arenaPG, arenaPG, bus, arenaWS, arenaClock, log,
)
stopArena := arenaMatchmaker.Start(ctx)
```

Adapter for the token verifier interface (drop it somewhere near the bottom of main.go):

```go
type tokenVerifierAdapter struct { issuer *authApp.TokenIssuer }

func (a tokenVerifierAdapter) VerifyAccess(raw string) (uuid.UUID, error) {
    claims, err := a.issuer.Parse(raw)
    if err != nil { return uuid.Nil, err }
    return uuid.Parse(claims.Subject)
}
```

## 3. Event subscriptions

Arena publishes but does not subscribe to any events in MVP. The rating domain
already subscribes to `arena.MatchCompleted` — nothing to add here.

## 4. Composite server embed line in `cmd/monolith/server.go`

```go
type Server struct {
    apigen.Unimplemented
    *authPorts.AuthServer
    *profilePorts.ProfileServer
    *dailyPorts.DailyServer
    *ratingPorts.RatingServer
    *arenaPorts.ArenaServer   // ← add this
}
```

And in the constructor:

```go
return &Server{
    AuthServer:    authServer,
    ProfileServer: profileServer,
    DailyServer:   dailyServer,
    RatingServer:  ratingServer,
    ArenaServer:   arenaServer, // ← add this
}
```

## 5. Manual WS route

oapi-codegen does not generate WS routes. After the generated router is mounted:

```go
r.Route("/ws", func(r chi.Router) {
    r.Get("/arena/{matchId}", arenaWS.WSHandler)
})
```

The handler performs token verification itself from `?token=` so it must NOT be
wrapped in `RequireAuth`.

## 6. Graceful shutdown

Before the HTTP server shuts down:

```go
stopArena()   // stops dispatcher goroutine, closes WS clients via GC cascade
```

The WS hub does not own an explicit stop — its per-connection goroutines exit
when the connection closes. If you need a hard shutdown, iterate
`hub.rooms` and close each `*client.conn` before `stopArena()`.
