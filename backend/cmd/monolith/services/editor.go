package services

import (
	"context"
	"os"
	"strings"
	"time"

	editorApp "druz9/editor/app"
	editorDomain "druz9/editor/domain"
	editorInfra "druz9/editor/infra"
	editorPorts "druz9/editor/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewEditor wires the collaborative-code editor (bible §3.1): rooms, role
// resolution, invite tokens, replay uploader, freeze + the WS hub. The
// invite secret falls back to the JWT secret when EDITOR_INVITE_SECRET is
// unset — same behaviour as the pre-refactor monolith.
func NewEditor(d Deps) *Module {
	rooms := editorInfra.NewRooms(d.Pool)
	parts := editorInfra.NewParticipants(d.Pool)
	replay := editorInfra.NewStubReplayUploader(d.Cfg.MinIO.Endpoint, time.Hour)
	hub := editorPorts.NewHub(d.Log)
	hub.RoomResolver = rooms.Get
	hub.RoleResolver = parts.GetRole

	inviteSecret := os.Getenv("EDITOR_INVITE_SECRET")
	if inviteSecret == "" {
		inviteSecret = d.Cfg.Auth.JWTSecret
	}

	create := &editorApp.CreateRoom{
		Rooms: rooms, Participants: parts,
		Log: d.Log, Now: d.Now, RoomTTL: 6 * time.Hour,
	}
	get := &editorApp.GetRoom{Rooms: rooms, Participants: parts}
	freeze := &editorApp.Freeze{
		Rooms: rooms, Participants: parts,
		Notifier: hub, Log: d.Log,
	}
	invite := &editorApp.CreateInvite{
		Rooms:   rooms,
		Secret:  []byte(inviteSecret),
		TTL:     24 * time.Hour,
		BaseURL: d.Cfg.Notify.PublicBaseURL,
		Now:     d.Now,
	}
	replayUC := &editorApp.Replay{
		Rooms: rooms, Participants: parts,
		Uploader: replay,
		Flush:    hub.FlushRoom,
	}
	// Judge0 wiring for RunCode. If JUDGE0_URL is empty we still construct
	// the use case with a client whose BaseURL is "" — Run will surface
	// ErrSandboxUnavailable → HTTP 503 with a helpful message, matching the
	// anti-fallback policy used by the daily service.
	var runner editorDomain.CodeRunner
	if u := strings.TrimSpace(d.Cfg.Judge0.URL); u != "" {
		runner = editorInfra.NewJudge0RunClient(u, d.Log)
		d.Log.Info("editor: Judge0 RunCode wired", "url", u)
	} else {
		d.Log.Warn("editor: JUDGE0_URL not set — /editor/room/{id}/run will return 503 (sandbox unavailable)")
		runner = editorInfra.NewJudge0RunClient("", d.Log)
	}
	runUC := &editorApp.RunCode{
		Rooms:        rooms,
		Participants: parts,
		Runner:       runner,
		Limiter:      editorApp.NewUserRateLimiter(10, time.Minute),
		Now:          d.Now,
	}
	server := editorPorts.NewEditorServer(
		create, get, invite, freeze, replayUC, runUC, "/ws/editor", d.Log,
	)
	wsh := editorPorts.NewWSHandler(hub, editorTokenVerifier{issuer: d.TokenIssuer}, rooms, parts, d.Log)

	connectPath, connectHandler := druz9v1connect.NewEditorServiceHandler(server)
	transcoder := mustTranscode("editor", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/editor/room", transcoder.ServeHTTP)
			r.Get("/editor/room/{roomId}", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/invite", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/freeze", transcoder.ServeHTTP)
			r.Get("/editor/room/{roomId}/replay", transcoder.ServeHTTP)
			r.Post("/editor/room/{roomId}/run", transcoder.ServeHTTP)
		},
		MountWS: func(ws chi.Router) {
			ws.Get("/editor/{roomId}", wsh.Handle)
		},
		Shutdown: []func(ctx context.Context) error{
			func(ctx context.Context) error { hub.CloseAll(); return nil },
		},
	}
}
