// Package services — wiring for the Custom-Lobby bounded context (WAVE-11).
//
// Endpoints come from proto/druz9/v1/lobby.proto. The HTTP/Connect surface
// lives in services/lobby/ports/server.go; this file is just the wiring
// glue + the cross-context arena adapter.
package circles

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	arenaDomain "druz9/arena/domain"
	arenaInfra "druz9/arena/infra"
	circlesInfra "druz9/circles/infra"
	monolithServices "druz9/cmd/monolith/services"
	lobbyApp "druz9/lobby/app"
	lobbyDomain "druz9/lobby/domain"
	lobbyPorts "druz9/lobby/ports"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewLobby wires the Custom-Lobby bounded context.
//
// We construct a fresh arena Postgres adapter (it's stateless — just a
// thin wrapper over the shared pool) so lobby doesn't have to reach across
// to arena.NewArena's local. This keeps wiring order in bootstrap free of
// arena→lobby cycles.
func NewLobby(d monolithServices.Deps) *monolithServices.Module {
	if d.Log == nil {
		panic("services.NewLobby: log is required")
	}
	if d.Pool == nil {
		panic("services.NewLobby: pool is required")
	}
	arenaPG := arenaInfra.NewPostgres(d.Pool)
	repo := circlesInfra.NewLobbyPostgres(d.Pool, d.Log)
	matches := &lobbyArenaAdapter{Arena: arenaPG, Tasks: arenaPG, Log: d.Log}

	server := &lobbyPorts.Server{
		Create: lobbyApp.NewCreateLobby(repo, d.Log),
		List:   lobbyApp.NewListPublicLobbies(repo, d.Log),
		Get:    lobbyApp.NewGetLobby(repo, d.Log),
		Join:   lobbyApp.NewJoinLobby(repo, d.Log),
		Leave:  lobbyApp.NewLeaveLobby(repo, d.Log),
		Start:  lobbyApp.NewStartLobby(repo, matches, d.Log),
		Cancel: lobbyApp.NewCancelLobby(repo, d.Log),
		Log:    d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewLobbyServiceHandler(server)
	transcoder := monolithServices.MustTranscode("lobby", connectPath, connectHandler)

	return &monolithServices.Module{
		ConnectPath:    connectPath,
		ConnectHandler: transcoder,
		MountPublicREST: func(r chi.Router) {
			// Discovery is anonymous — proto routes them under /api/v1/lobby/*
			// and the public mount makes them reachable without a bearer.
			r.Get("/lobby/list", transcoder.ServeHTTP)
			r.Get("/lobby/{id}", transcoder.ServeHTTP)
			r.Get("/lobby/code/{code}", transcoder.ServeHTTP)
		},
		MountREST: func(r chi.Router) {
			// Auth-required writes — same transcoder, requireAuth applied
			// at the /api/v1 mount level.
			r.Post("/lobby", transcoder.ServeHTTP)
			r.Post("/lobby/{id}/join", transcoder.ServeHTTP)
			r.Post("/lobby/{id}/leave", transcoder.ServeHTTP)
			r.Post("/lobby/{id}/start", transcoder.ServeHTTP)
			r.Post("/lobby/{id}/cancel", transcoder.ServeHTTP)
		},
	}
}

// ── Arena cross-context adapter ───────────────────────────────────────────

// lobbyArenaAdapter implements lobby/domain.MatchCreator on top of arena's
// Postgres MatchRepo + TaskRepo. Lives here so lobby/go.mod stays pgx-free.
type lobbyArenaAdapter struct {
	Arena *arenaInfra.Postgres
	Tasks *arenaInfra.Postgres
	Log   *slog.Logger
}

// CreateMatch maps lobby parameters → arena domain types and inserts a fresh
// arena_match in status='active'. Team layout: 1v1 → both team=1 (legacy
// arena entity treats winner_id, not team), 2v2 → first 2 team=1, rest team=2.
func (a *lobbyArenaAdapter) CreateMatch(
	ctx context.Context,
	mode lobbyDomain.Mode,
	section, difficulty string,
	userIDs []uuid.UUID,
) (uuid.UUID, error) {
	if a.Arena == nil || a.Tasks == nil {
		return uuid.Nil, errors.New("lobby.arena: postgres not wired")
	}
	if len(userIDs) < 2 {
		return uuid.Nil, fmt.Errorf("lobby.arena: need >=2 users, got %d", len(userIDs))
	}
	sec := enums.Section(section)
	if !sec.IsValid() {
		return uuid.Nil, fmt.Errorf("lobby.arena: invalid section %q", section)
	}
	diff := enums.Difficulty(difficulty)
	if !diff.IsValid() {
		return uuid.Nil, fmt.Errorf("lobby.arena: invalid difficulty %q", difficulty)
	}
	task, err := a.Tasks.PickBySectionDifficulty(ctx, sec, diff)
	if err != nil {
		return uuid.Nil, fmt.Errorf("lobby.arena: pick task: %w", err)
	}

	var arenaMode enums.ArenaMode
	switch mode {
	case lobbyDomain.Mode1v1:
		arenaMode = enums.ArenaModeSolo1v1
	case lobbyDomain.Mode2v2:
		arenaMode = enums.ArenaModeDuo2v2
	default:
		return uuid.Nil, fmt.Errorf("lobby.arena: unknown mode %q", mode)
	}

	parts := make([]arenaDomain.Participant, 0, len(userIDs))
	for i, uid := range userIDs {
		team := 1
		if mode == lobbyDomain.Mode2v2 && i >= 2 {
			team = 2
		}
		parts = append(parts, arenaDomain.Participant{
			UserID:    uid,
			Team:      team,
			EloBefore: arenaDomain.InitialELO,
		})
	}
	now := time.Now().UTC()
	m := arenaDomain.Match{
		TaskID:      task.ID,
		TaskVersion: task.Version,
		Section:     sec,
		Mode:        arenaMode,
		Status:      enums.MatchStatusActive,
		StartedAt:   &now,
	}
	created, err := a.Arena.CreateMatch(ctx, m, parts)
	if err != nil {
		return uuid.Nil, fmt.Errorf("lobby.arena: persist: %w", err)
	}
	return created.ID, nil
}
