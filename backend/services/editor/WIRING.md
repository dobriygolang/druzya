# editor wiring cheat sheet

This file collects the snippets that need to be added to
`cmd/monolith/main.go` and `cmd/monolith/server.go` to light the editor
domain up. **Do not touch those two files in this PR** — they are the
stable seam for whoever runs the wiring PR.

---

## 1. Imports — `cmd/monolith/main.go`

```go
editorApp    "druz9/editor/app"
editorInfra  "druz9/editor/infra"
editorPorts  "druz9/editor/ports"
```

## 2. Invite HMAC secret

Pick ONE of the options and document in the ops runbook:

**Recommended**: add a dedicated `EDITOR_INVITE_SECRET` env var. Separate
from `JWT_SECRET` so invite token rotation is decoupled from session-token
rotation (invite TTLs are days, JWT TTLs are minutes).

`cmd/monolith/config.go`:
```go
type Config struct {
    // …
    EditorInviteSecret string `env:"EDITOR_INVITE_SECRET"`
}
```

`.env.example`:
```
EDITOR_INVITE_SECRET=change-me-random-32-byte-secret
```

**Fallback**: if you don't want the extra env var, reuse `JWT_SECRET` —
it is already 32+ bytes and rotated on the same cadence. The only risk is
that rotating JWTs invalidates outstanding invite links, which is harmless
(users simply request a new invite). Configure the fallback this way:

```go
inviteSecret := cfg.EditorInviteSecret
if inviteSecret == "" {
    inviteSecret = cfg.JWTSecret
}
```

## 3. Constructor block — after the AI Mock wiring block

Assumes `pool *pgxpool.Pool`, `log *slog.Logger`, `now func() time.Time`,
`tokenIssuer *authApp.TokenIssuer`, and `cfg` are already in scope.

```go
// ── Editor wiring
editorRooms   := editorInfra.NewRooms(pool)
editorParts   := editorInfra.NewParticipants(pool)
editorReplay  := editorInfra.NewStubReplayUploader(cfg.MinIO.Endpoint, time.Hour) // STUB

editorHub := editorPorts.NewHub(log)
// RoomResolver / RoleResolver are set automatically on first WS connect; set them
// up-front here too so HTTP-only freeze broadcasts work even before the first ws.
editorHub.RoomResolver = editorRooms.Get
editorHub.RoleResolver = editorParts.GetRole

createRoom  := &editorApp.CreateRoom{
    Rooms: editorRooms, Participants: editorParts,
    Log: log, Now: now, RoomTTL: 6 * time.Hour,
}
getRoom     := &editorApp.GetRoom{
    Rooms: editorRooms, Participants: editorParts,
    // Tasks: wire an editor-local adapter if/when you want the full TaskPublic
    // inlined into the room view.
}
freezeRoom  := &editorApp.Freeze{
    Rooms: editorRooms, Participants: editorParts,
    Notifier: editorHub, Log: log,
}
inviteRoom  := &editorApp.CreateInvite{
    Rooms: editorRooms,
    Secret: []byte(inviteSecret),
    TTL: 24 * time.Hour,
    BaseURL: cfg.PublicBaseURL,
    Now: now,
}
replayRoom  := &editorApp.Replay{
    Rooms: editorRooms, Participants: editorParts,
    Uploader: editorReplay,
    Flush: editorHub.FlushRoom,
}

editorServer := editorPorts.NewEditorServer(
    createRoom, getRoom, inviteRoom, freezeRoom, replayRoom,
    "/ws/editor", log,
)

// Token verifier adapter (same pattern arena uses with tokenVerifierAdapter).
// editor's domain.TokenVerifier expects Verify(raw string) (uuid.UUID, error).
editorVerifier := editorTokenVerifierAdapter{issuer: tokenIssuer}

editorWS := editorPorts.NewWSHandler(editorHub, editorVerifier, editorRooms, editorParts, log)
```

Adapter (drop alongside arena's `tokenVerifierAdapter`):

```go
type editorTokenVerifierAdapter struct { issuer *authApp.TokenIssuer }

func (a editorTokenVerifierAdapter) Verify(raw string) (uuid.UUID, error) {
    claims, err := a.issuer.Parse(raw)
    if err != nil { return uuid.Nil, err }
    return uuid.Parse(claims.Subject)
}
```

## 4. Composite server embed — `cmd/monolith/server.go`

Add alongside the Guild block:

```go
import editorPorts "druz9/editor/ports"

type compositeServer struct {
    apigen.Unimplemented
    // … existing …
    Editor *editorPorts.EditorServer // ← new
}

// ── editor ─────────────────────────────────────────────────────────────
func (s *compositeServer) PostEditorRoom(w http.ResponseWriter, r *http.Request) {
    s.Editor.PostEditorRoom(w, r)
}
func (s *compositeServer) GetEditorRoomRoomId(w http.ResponseWriter, r *http.Request, roomId openapi_types.UUID) {
    s.Editor.GetEditorRoomRoomId(w, r, roomId)
}
func (s *compositeServer) PostEditorRoomRoomIdInvite(w http.ResponseWriter, r *http.Request, roomId openapi_types.UUID) {
    s.Editor.PostEditorRoomRoomIdInvite(w, r, roomId)
}
func (s *compositeServer) PostEditorRoomRoomIdFreeze(w http.ResponseWriter, r *http.Request, roomId openapi_types.UUID) {
    s.Editor.PostEditorRoomRoomIdFreeze(w, r, roomId)
}
func (s *compositeServer) GetEditorRoomRoomIdReplay(w http.ResponseWriter, r *http.Request, roomId openapi_types.UUID) {
    s.Editor.GetEditorRoomRoomIdReplay(w, r, roomId)
}
```

And in the composite-server constructor call:

```go
srv := &compositeServer{
    // … existing …
    Editor: editorServer, // ← new
}
```

## 5. WebSocket route

Register alongside the existing arena / mock / feed routes. Websockets are
NOT wrapped in `requireAuth` — they auth via `?token=<JWT>`.

```go
r.Route("/ws", func(r chi.Router) {
    r.Get("/arena/{matchId}",   arenaWS.WSHandler)
    r.Get("/mock/{sessionId}",  mockWS.Handle)
    r.Get("/editor/{roomId}",   editorWS.Handle) // ← new
})
```

## 6. Event subscriptions

The editor domain neither publishes nor subscribes to any cross-domain
events in MVP — invite acceptance is HTTP-only and freeze fanout is a hub
broadcast. Nothing to add to the event-subscription block.

## 7. Graceful shutdown

After `httpSrv.Shutdown` returns, close every open editor connection and
give them a chance to drain:

```go
editorHub.CloseAll()
```

The per-connection goroutines exit when the underlying `*websocket.Conn`
closes, so `CloseAll()` is the only call needed. Replay buffers live
in-memory only — they are discarded at shutdown (bible §6: replay is
best-effort; permanent archives live in MinIO via `/replay`).

## 8. Sanity check

```bash
make gen-sqlc
cd backend/services/editor && go generate ./domain/...
go test -race ./...
```

All three must be green after the wiring PR.
