# Season domain — cmd/monolith wiring

The season domain does not edit `cmd/monolith/main.go` or
`cmd/monolith/server.go`. Paste the snippets below into those files when
wiring the domain in.

## 1. Imports to add to `cmd/monolith/main.go`

```go
import (
    seasonApp    "druz9/season/app"
    seasonInfra  "druz9/season/infra"
    seasonPorts  "druz9/season/ports"
)
```

`log/slog` and `bus` (sharedDomain.Bus) should already be in scope.

## 2. Constructor calls (in `main()` after Postgres/Bus/Logger are built)

Assumes `pool *pgxpool.Pool`, `bus sharedDomain.Bus` and `log *slog.Logger`
are already in scope.

```go
// --- season ---
seasonPG         := seasonInfra.NewPostgres(pool)
seasonTiers      := seasonInfra.NewStaticTiers()
seasonChallenges := seasonInfra.NewStaticChallenges()
seasonClaims     := seasonInfra.NewMemClaimStore() // STUB: in-memory

seasonGetCurrent := seasonApp.NewGetCurrent(seasonPG, seasonTiers, seasonChallenges, seasonClaims)
// ClaimReward has no HTTP endpoint yet; construct if you want to exercise it
// from admin or a debug route.
_ = seasonApp.NewClaimReward(seasonPG, seasonTiers, seasonClaims)

seasonOnXP    := seasonApp.NewOnXPGained(seasonPG, seasonTiers, bus, log)
seasonOnWin   := seasonApp.NewOnMatchCompleted(seasonPG, seasonTiers, bus, log)
seasonOnKata  := seasonApp.NewOnDailyKataCompleted(seasonPG, seasonTiers, bus, log)
seasonOnMock  := seasonApp.NewOnMockSessionFinished(seasonPG, seasonTiers, bus, log)
seasonApp.SubscribeHandlers(bus, seasonOnXP, seasonOnWin, seasonOnKata, seasonOnMock)

seasonServer := seasonPorts.NewSeasonServer(seasonGetCurrent, log)
```

## 3. Event subscriptions

`seasonApp.SubscribeHandlers` (called above) registers:

- `progress.XPGained`        → `seasonOnXP.Handle`    (+1 SP per 10 XP)
- `arena.MatchCompleted`     → `seasonOnWin.Handle`   (+50 SP to winner)
- `daily.KataCompleted`      → `seasonOnKata.Handle`  (+30 SP, ×3 cursed)
- `mock.SessionFinished`     → `seasonOnMock.Handle`  (+80 SP if score ≥ 60 and not abandoned)

Season also **publishes** `season.PointsEarned` on every increment.

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
    Guild   *guildPorts.GuildServer
    Season  *seasonPorts.SeasonServer // ← add this
}
```

And in the constructor:

```go
return &compositeServer{
    // ...
    Season: seasonServer, // ← add this
}
```

## 5. Per-method forwarders in `cmd/monolith/server.go`

```go
// ── season ─────────────────────────────────────────────────────────────────

func (s *compositeServer) GetSeasonCurrent(w http.ResponseWriter, r *http.Request) {
    s.Season.GetSeasonCurrent(w, r)
}
```

## 6. go.work

`go.work` already includes `./services/season` — no change needed.

## 7. Suggested env vars (dynamic config placeholders)

Document only — not wired in MVP:

- `SP_PER_XP_RATIO`          (int, default `10`) — divider for XPGained → SP.
  Replace `domain.DefaultSPPerXPRatio` read site in `app/handlers.go::OnXPGained`.
- `SEASON_PASS_ENABLED`      (bool, default `true`) — mirror the existing
  `season_pass_enabled` dynamic_config key so the handlers short-circuit when
  the pass is disabled.

## Notes & STUBs

- **Reward tiers + weekly challenges are hardcoded** in
  `infra/static_config.go`. 40 tiers per track (Free / Premium); 4 weekly
  challenges that run every week (IsoWeek=0). Swap for CMS-backed repos when
  `season_rewards` and `weekly_challenges` tables land.
- **Per-user challenge progress is not persisted.** The GET endpoint returns
  `progress: 0` for every challenge. Add a `season_challenge_progress` table
  and corresponding sqlc queries when the challenge-completion flow ships.
- **Claims are in-memory.** `infra.memClaimStore` is a stopgap — add a
  `season_reward_claims(user_id, season_id, kind, tier, claimed_at)` table
  and replace the constructor call.
- **`ClaimReward` has no HTTP route** because `shared/openapi.yaml` doesn't
  expose one yet. The helper is ready to wire as soon as the contract grows
  a `POST /season/claim` endpoint.
- **SP conversion ratio is hardcoded.** Replace with a read-through from
  `dynamic_config` (`sp_per_xp_ratio`) once a config accessor is available.
