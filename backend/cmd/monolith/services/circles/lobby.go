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
//
// Solo lobby (Phase 2c-2): mode=solo permits a single participant. When
// skillFilter is non-empty, the task picker first attempts
// PickBySkillFilter; if no task matches the filter we fall back to the
// section/difficulty pick so the lobby never hard-fails on an unindexed
// catalog.
func (a *lobbyArenaAdapter) CreateMatch(
	ctx context.Context,
	mode lobbyDomain.Mode,
	section, difficulty string,
	userIDs []uuid.UUID,
	skillFilter []string,
) (uuid.UUID, error) {
	if a.Arena == nil || a.Tasks == nil {
		return uuid.Nil, errors.New("lobby.arena: postgres not wired")
	}
	minUsers := 2
	if mode == lobbyDomain.ModeSolo {
		minUsers = 1
	}
	if len(userIDs) < minUsers {
		return uuid.Nil, fmt.Errorf("lobby.arena: need >=%d users, got %d", minUsers, len(userIDs))
	}
	sec := enums.Section(section)
	if !sec.IsValid() {
		return uuid.Nil, fmt.Errorf("lobby.arena: invalid section %q", section)
	}
	diff := enums.Difficulty(difficulty)
	if !diff.IsValid() {
		return uuid.Nil, fmt.Errorf("lobby.arena: invalid difficulty %q", difficulty)
	}
	var (
		task arenaDomain.TaskPublic
		err  error
	)
	if mode == lobbyDomain.ModeSolo && len(skillFilter) > 0 {
		task, err = a.Tasks.PickBySkillFilter(ctx, skillFilter, sec, diff)
		if err != nil && errors.Is(err, arenaDomain.ErrNotFound) {
			task, err = a.Tasks.PickBySectionDifficulty(ctx, sec, diff)
		}
	} else {
		task, err = a.Tasks.PickBySectionDifficulty(ctx, sec, diff)
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("lobby.arena: pick task: %w", err)
	}

	// Phase 1.7 — Mode2v2 retired. Lobby exposes only 1v1 now; the
	// ArenaModeDuo2v2 constant survives in the enum so historical
	// arena_match rows still parse, but no new rows reach this path.
	// Phase 2c-2 — solo single-player drill rooms map to the same
	// solo_1v1 arena mode (single arena_participant row); arena's
	// kata-style scoring already handles single-participant matches.
	var arenaMode enums.ArenaMode
	switch mode {
	case lobbyDomain.Mode1v1, lobbyDomain.ModeSolo:
		arenaMode = enums.ArenaModeSolo1v1
	default:
		return uuid.Nil, fmt.Errorf("lobby.arena: unknown mode %q", mode)
	}

	parts := make([]arenaDomain.Participant, 0, len(userIDs))
	for _, uid := range userIDs {
		parts = append(parts, arenaDomain.Participant{
			UserID:    uid,
			Team:      1,
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
