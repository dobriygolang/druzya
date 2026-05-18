# Podcast domain — cmd/monolith wiring

The podcast domain does not edit `cmd/monolith/main.go` or
`cmd/monolith/server.go`. Paste the snippets below into those files when
wiring the domain in.

## 1. Imports to add to `cmd/monolith/main.go`

```go
import (
    podcastApp   "druz9/podcast/app"
    podcastInfra "druz9/podcast/infra"
    podcastPorts "druz9/podcast/ports"
)
```

`log/slog` and `bus` (sharedDomain.Bus) should already be in scope.

## 2. Constructor calls (in `main()` after Postgres/Bus/Logger are built)

Assumes `pool *pgxpool.Pool`, `bus sharedDomain.Bus` and `log *slog.Logger`
are already in scope.

```go
// --- podcast ---
podcastPG     := podcastInfra.NewPostgres(pool)
podcastStore  := podcastInfra.NewMinIOPodcastStore(/* … from cfg.MinIO … */)
podcastSigner := podcastInfra.NewMinioAudioSigner(podcastStore, podcastInfra.DefaultAudioSignTTL)

podcastList   := podcastApp.NewListCatalog(podcastPG, podcastSigner)
podcastUpdate := podcastApp.NewUpdateProgress(podcastPG, bus, log)

podcastApp.SubscribeHandlers(bus) // no-op today; kept for future growth

podcastServer := podcastPorts.NewPodcastServer(podcastList, podcastUpdate, log)
```

## 3. Event subscriptions

None today. Podcast **publishes** two events on first completion:

- `podcast.Completed` — LOCAL (defined in `services/podcast/domain/events.go`).
  No current shared-bus subscriber; future in-domain consumers can pick it up.
- `progress.XPGained` — SHARED. Amount = `domain.PodcastXPPerEpisode` (50 XP).
  This is how season credits podcasts: season subscribes to `XPGained` and
  converts 50 XP → 5 SP (default ratio).

Flow diagram (completion):

```
PUT /podcast/{id}/progress
        │
        ▼
UpdateProgress.Do  ─►  domain.ApplyProgress  ─►  UpsertProgress
        │
        ▼ (only on nil→non-nil transition)
Bus.Publish(PodcastCompleted)     (local)
Bus.Publish(XPGained, 50)         (shared)  ───►  season.OnXPGained  ───►  +5 SP
```

## 4. Composite server embed line in `cmd/monolith/server.go`

```go
type compositeServer struct {
    apigen.Unimplemented
    Auth    *authPorts.AuthServer
    Profile *profilePorts.ProfileServer
    Mock    *aimockPorts.MockServer
    Notify  *notifyPorts.NotifyServer
    Podcast *podcastPorts.PodcastServer // ← add this
}
```

And in the constructor:

```go
return &compositeServer{
    // ...
    Podcast: podcastServer, // ← add this
}
```

## 5. Per-method forwarders in `cmd/monolith/server.go`

```go
// ── podcast ────────────────────────────────────────────────────────────────

func (s *compositeServer) GetPodcast(w http.ResponseWriter, r *http.Request, params apigen.GetPodcastParams) {
    s.Podcast.GetPodcast(w, r, params)
}
func (s *compositeServer) PutPodcastPodcastIdProgress(w http.ResponseWriter, r *http.Request, podcastId openapi_types.UUID) {
    s.Podcast.PutPodcastPodcastIdProgress(w, r, podcastId)
}
```

## 6. go.work

`go.work` already includes `./services/podcast` — no change needed.

## 7. Suggested env vars (dynamic config placeholders)

Document only — not wired in MVP:

- `PODCAST_XP_PER_EPISODE` (int, default `50`) — XP granted on first
  completion. Replaces `domain.PodcastXPPerEpisode` read site in
  `app/update_progress.go::publishCompletion`.

## Notes & STUBs

- **Audio URL presigning is real.** `infra.MinioAudioSigner` wraps
  `domain.PodcastObjectStore.PresignGet` with `DefaultAudioSignTTL` (60 min).
  When MinIO creds are missing the wiring substitutes
  `infra.UnconfiguredObjectStore`, so every `Sign` call returns
  `ErrObjectStoreUnavailable` and `ListCatalog` propagates a real error
  rather than a placeholder URL.
- **Localization is RU-first.** The REST response uses `title_ru` with a
  fallback to `title_en`. A later pass will switch on the caller's locale
  (bible §12 — internationalisation).
- **Per-user challenge progress bleed-through** between podcast completion
  and season weekly challenges is explicitly out of scope: podcast's
  `XPGained` event is the only cross-domain signal today.
- **No inbound subscriptions.** `SubscribeHandlers` is a no-op placeholder.
