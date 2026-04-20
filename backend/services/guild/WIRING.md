# Guild domain — cmd/monolith wiring

The guild domain does not edit `cmd/monolith/main.go` or `cmd/monolith/server.go`.
Paste the snippets below into those files when wiring the domain in.

## 1. Imports to add to `cmd/monolith/main.go`

```go
import (
    guildApp    "druz9/guild/app"
    guildDomain "druz9/guild/domain"
    guildInfra  "druz9/guild/infra"
    guildPorts  "druz9/guild/ports"
)
```

`log/slog` and `bus` (sharedDomain.Bus) should already be in scope.

## 2. Constructor calls (in `main()` after Postgres/Bus/Logger are built)

Assumes `pool *pgxpool.Pool`, `bus sharedDomain.Bus` and `log *slog.Logger`
are already in scope.

```go
// --- guild ---
guildPG     := guildInfra.NewPostgres(pool)
guildJudge0 := guildInfra.NewFakeJudge0() // STUB — swap for real Judge0 client
guildClock  := guildDomain.RealClock{}

guildMyGuild := &guildApp.GetMyGuild{
    Guilds: guildPG, Wars: guildPG, Clock: guildClock,
}
guildGet := &guildApp.GetGuild{
    Guilds: guildPG, Wars: guildPG, Clock: guildClock,
}
guildWar := &guildApp.GetWar{
    Guilds: guildPG, Wars: guildPG, Clock: guildClock,
}
guildContribute := &guildApp.Contribute{
    Guilds: guildPG, Wars: guildPG, Judge0: guildJudge0,
    GetWar: guildWar, Clock: guildClock, Log: log,
}

guildOnMatch := &guildApp.OnMatchCompleted{Guilds: guildPG, Log: log}

// Subscribe to arena.MatchCompleted so guild can bump next-week seed.
guildApp.SubscribeHandlers(bus, guildOnMatch)

guildServer := guildPorts.NewGuildServer(
    guildMyGuild, guildGet, guildWar, guildContribute, log,
)
```

## 3. Event subscriptions

`guildApp.SubscribeHandlers` (called above) registers:

- `arena.MatchCompleted` → `guildOnMatch.HandleMatchCompleted`

Future subscribers (spectator / raid events) should be added to
`services/guild/app/handlers.go::SubscribeHandlers`, not here.

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
    Guild   *guildPorts.GuildServer // ← add this
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
    Guild:   guildServer, // ← add this
}
```

## 5. Per-method forwarders in `cmd/monolith/server.go`

```go
// ── guild ──────────────────────────────────────────────────────────────────

func (s *compositeServer) GetGuildMy(w http.ResponseWriter, r *http.Request) {
    s.Guild.GetGuildMy(w, r)
}
func (s *compositeServer) GetGuildGuildId(w http.ResponseWriter, r *http.Request, guildId openapi_types.UUID) {
    s.Guild.GetGuildGuildId(w, r, guildId)
}
func (s *compositeServer) GetGuildGuildIdWar(w http.ResponseWriter, r *http.Request, guildId openapi_types.UUID) {
    s.Guild.GetGuildGuildIdWar(w, r, guildId)
}
func (s *compositeServer) PostGuildGuildIdWarContribute(w http.ResponseWriter, r *http.Request, guildId openapi_types.UUID) {
    s.Guild.PostGuildGuildIdWarContribute(w, r, guildId)
}
```

## 6. go.work

If the monolith's `go.work` does not already include guild, add:

```
use ./services/guild
```

## Notes & STUBs

- `guildInfra.FakeJudge0` — swap for real Judge0 client once available.
- `OnMatchCompleted.Apply` logs a "seedBump (STUB)" — replace with a real
  next-week seed bump when season pairing lands.
- Contributions are stored **in-memory** in `guildInfra.Postgres` because
  migration 00005 has no `guild_war_contributions` table. The JSONB score map
  on `guild_wars` is the source of truth for the visible tally.
- There is no shared `GuildWarLineScoreUpdated` event yet — the Contribute use
  case logs a LOCAL marker instead of publishing, per the scope guidance.
