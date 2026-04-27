// Package services — wiring for the Custom-Lobby bounded context (WAVE-11).
package circles

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	arenaDomain "druz9/arena/domain"
	arenaInfra "druz9/arena/infra"
	circlesInfra "druz9/circles/infra"
	monolithServices "druz9/cmd/monolith/services"
	lobbyApp "druz9/lobby/app"
	lobbyDomain "druz9/lobby/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

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

	create := lobbyApp.NewCreateLobby(repo, d.Log)
	list := lobbyApp.NewListPublicLobbies(repo, d.Log)
	get := lobbyApp.NewGetLobby(repo, d.Log)
	join := lobbyApp.NewJoinLobby(repo, d.Log)
	leave := lobbyApp.NewLeaveLobby(repo, d.Log)
	start := lobbyApp.NewStartLobby(repo, matches, d.Log)
	cancel := lobbyApp.NewCancelLobby(repo, d.Log)

	h := &lobbyHTTP{
		Create: create, List: list, Get: get, Join: join,
		Leave: leave, Start: start, Cancel: cancel, Log: d.Log,
	}

	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			// Public discovery / detail / code lookup.
			r.Get("/lobby/list", h.handleList)
			r.Get("/lobby/{id}", h.handleGet)
			r.Get("/lobby/code/{code}", h.handleByCode)

			// Auth-required writes.
			r.Post("/lobby", h.handleCreate)
			r.Post("/lobby/{id}/join", h.handleJoin)
			r.Post("/lobby/{id}/leave", h.handleLeave)
			r.Post("/lobby/{id}/start", h.handleStart)
			r.Post("/lobby/{id}/cancel", h.handleCancel)
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

// ── HTTP handlers ─────────────────────────────────────────────────────────

type lobbyHTTP struct {
	Create *lobbyApp.CreateLobby
	List   *lobbyApp.ListPublicLobbies
	Get    *lobbyApp.GetLobby
	Join   *lobbyApp.JoinLobby
	Leave  *lobbyApp.LeaveLobby
	Start  *lobbyApp.StartLobby
	Cancel *lobbyApp.CancelLobby
	Log    *slog.Logger
}

type lobbyDTO struct {
	ID           string  `json:"id"`
	Code         string  `json:"code"`
	OwnerID      string  `json:"owner_id"`
	Mode         string  `json:"mode"`
	Section      string  `json:"section"`
	Difficulty   string  `json:"difficulty"`
	Visibility   string  `json:"visibility"`
	MaxMembers   int     `json:"max_members"`
	AIAllowed    bool    `json:"ai_allowed"`
	TimeLimitMin int     `json:"time_limit_min"`
	Status       string  `json:"status"`
	MatchID      *string `json:"match_id"`
	MembersCount int     `json:"members_count"`
	CreatedAt    string  `json:"created_at"`
}

type lobbyMemberDTO struct {
	UserID   string `json:"user_id"`
	Role     string `json:"role"`
	Team     int    `json:"team"`
	JoinedAt string `json:"joined_at"`
}

func toLobbyDTO(l lobbyDomain.Lobby, count int) lobbyDTO {
	var matchID *string
	if l.MatchID != nil {
		s := l.MatchID.String()
		matchID = &s
	}
	return lobbyDTO{
		ID: l.ID.String(), Code: l.Code, OwnerID: l.OwnerID.String(),
		Mode: string(l.Mode), Section: l.Section, Difficulty: l.Difficulty,
		Visibility: string(l.Visibility), MaxMembers: l.MaxMembers,
		AIAllowed: l.AIAllowed, TimeLimitMin: l.TimeLimitMin,
		Status: string(l.Status), MatchID: matchID,
		MembersCount: count,
		CreatedAt:    l.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func writeLobbyErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}

func writeLobbyJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// GET /lobby/list
func (h *lobbyHTTP) handleList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	f := lobbyDomain.ListFilter{
		Visibility: lobbyDomain.Visibility(strings.TrimSpace(q.Get("visibility"))),
		Mode:       lobbyDomain.Mode(strings.TrimSpace(q.Get("mode"))),
		Section:    strings.TrimSpace(q.Get("section")),
		Limit:      limit,
	}
	out, err := h.List.Do(r.Context(), f)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "lobby.List", slog.Any("err", err))
		writeLobbyErr(w, http.StatusInternalServerError, "list failed")
		return
	}
	items := make([]lobbyDTO, 0, len(out))
	for _, l := range out {
		// MembersCount=0 — list endpoint оставляет дешёвый: фронт сам дёрнет
		// /lobby/{id} для детальной карточки. Anti-fallback: не врём числом.
		items = append(items, toLobbyDTO(l, 0))
	}
	writeLobbyJSON(w, http.StatusOK, map[string]any{"items": items})
}

type createLobbyReq struct {
	Mode         string `json:"mode"`
	Section      string `json:"section"`
	Difficulty   string `json:"difficulty"`
	Visibility   string `json:"visibility"`
	MaxMembers   int    `json:"max_members"`
	AIAllowed    bool   `json:"ai_allowed"`
	TimeLimitMin int    `json:"time_limit_min"`
}

// POST /lobby
func (h *lobbyHTTP) handleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeLobbyErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req createLobbyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeLobbyErr(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	in := lobbyApp.CreateLobbyInput{
		OwnerID:      uid,
		Mode:         lobbyDomain.Mode(req.Mode),
		Section:      req.Section,
		Difficulty:   req.Difficulty,
		Visibility:   lobbyDomain.Visibility(req.Visibility),
		MaxMembers:   req.MaxMembers,
		AIAllowed:    req.AIAllowed,
		TimeLimitMin: req.TimeLimitMin,
	}
	l, err := h.Create.Do(r.Context(), in)
	if err != nil {
		switch {
		case errors.Is(err, lobbyApp.ErrInvalidInput):
			writeLobbyErr(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, lobbyDomain.ErrCodeExhausted):
			writeLobbyErr(w, http.StatusServiceUnavailable, "code generator exhausted")
		default:
			h.Log.ErrorContext(r.Context(), "lobby.Create", slog.Any("err", err))
			writeLobbyErr(w, http.StatusInternalServerError, "create failed")
		}
		return
	}
	writeLobbyJSON(w, http.StatusCreated, toLobbyDTO(l, 1))
}

// GET /lobby/{id}
func (h *lobbyHTTP) handleGet(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeLobbyErr(w, http.StatusBadRequest, "invalid lobby id")
		return
	}
	view, err := h.Get.Do(r.Context(), id)
	if err != nil {
		if errors.Is(err, lobbyDomain.ErrNotFound) {
			writeLobbyErr(w, http.StatusNotFound, "lobby not found")
			return
		}
		h.Log.ErrorContext(r.Context(), "lobby.Get", slog.Any("err", err))
		writeLobbyErr(w, http.StatusInternalServerError, "get failed")
		return
	}
	writeLobbyJSON(w, http.StatusOK, lobbyDetail(view))
}

// GET /lobby/code/{code}
func (h *lobbyHTTP) handleByCode(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	view, err := h.Get.DoByCode(r.Context(), code)
	if err != nil {
		switch {
		case errors.Is(err, lobbyDomain.ErrNotFound):
			writeLobbyErr(w, http.StatusNotFound, "lobby not found")
		case errors.Is(err, lobbyApp.ErrInvalidInput):
			writeLobbyErr(w, http.StatusBadRequest, err.Error())
		default:
			h.Log.ErrorContext(r.Context(), "lobby.GetByCode", slog.Any("err", err))
			writeLobbyErr(w, http.StatusInternalServerError, "get failed")
		}
		return
	}
	writeLobbyJSON(w, http.StatusOK, lobbyDetail(view))
}

func lobbyDetail(view lobbyDomain.LobbyView) map[string]any {
	members := make([]lobbyMemberDTO, 0, len(view.Members))
	for _, m := range view.Members {
		members = append(members, lobbyMemberDTO{
			UserID: m.UserID.String(), Role: string(m.Role), Team: m.Team,
			JoinedAt: m.JoinedAt.UTC().Format(time.RFC3339),
		})
	}
	return map[string]any{
		"lobby":   toLobbyDTO(view.Lobby, len(view.Members)),
		"members": members,
	}
}

// POST /lobby/{id}/join
func (h *lobbyHTTP) handleJoin(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeLobbyErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeLobbyErr(w, http.StatusBadRequest, "invalid lobby id")
		return
	}
	l, err := h.Join.DoByID(r.Context(), id, uid)
	switch {
	case err == nil:
		writeLobbyJSON(w, http.StatusOK, map[string]any{
			"status": "joined", "lobby": toLobbyDTO(l, 0),
		})
	case errors.Is(err, lobbyDomain.ErrNotFound):
		writeLobbyErr(w, http.StatusNotFound, "lobby not found")
	case errors.Is(err, lobbyDomain.ErrAlreadyMember):
		writeLobbyErr(w, http.StatusConflict, "already a member")
	case errors.Is(err, lobbyDomain.ErrFull):
		writeLobbyErr(w, http.StatusConflict, "lobby is full")
	case errors.Is(err, lobbyDomain.ErrClosed):
		writeLobbyErr(w, http.StatusConflict, "lobby is not open")
	default:
		h.Log.ErrorContext(r.Context(), "lobby.Join", slog.Any("err", err))
		writeLobbyErr(w, http.StatusInternalServerError, "join failed")
	}
}

// POST /lobby/{id}/leave
func (h *lobbyHTTP) handleLeave(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeLobbyErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeLobbyErr(w, http.StatusBadRequest, "invalid lobby id")
		return
	}
	res, err := h.Leave.Do(r.Context(), id, uid)
	switch {
	case err == nil:
		writeLobbyJSON(w, http.StatusOK, map[string]any{
			"status": res.Status, "lobby_id": id.String(),
		})
	case errors.Is(err, lobbyDomain.ErrNotFound):
		writeLobbyErr(w, http.StatusNotFound, "not a member")
	default:
		h.Log.ErrorContext(r.Context(), "lobby.Leave", slog.Any("err", err))
		writeLobbyErr(w, http.StatusInternalServerError, "leave failed")
	}
}

// POST /lobby/{id}/start
func (h *lobbyHTTP) handleStart(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeLobbyErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeLobbyErr(w, http.StatusBadRequest, "invalid lobby id")
		return
	}
	l, err := h.Start.Do(r.Context(), id, uid)
	switch {
	case err == nil:
		writeLobbyJSON(w, http.StatusOK, map[string]any{
			"status": "started", "lobby": toLobbyDTO(l, 0),
		})
	case errors.Is(err, lobbyDomain.ErrNotFound):
		writeLobbyErr(w, http.StatusNotFound, "lobby not found")
	case errors.Is(err, lobbyDomain.ErrForbidden):
		writeLobbyErr(w, http.StatusForbidden, "only owner can start")
	case errors.Is(err, lobbyDomain.ErrClosed):
		writeLobbyErr(w, http.StatusConflict, "lobby not open")
	case errors.Is(err, lobbyApp.ErrInvalidInput):
		writeLobbyErr(w, http.StatusBadRequest, err.Error())
	default:
		h.Log.ErrorContext(r.Context(), "lobby.Start", slog.Any("err", err))
		writeLobbyErr(w, http.StatusInternalServerError, "start failed")
	}
}

// POST /lobby/{id}/cancel
func (h *lobbyHTTP) handleCancel(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeLobbyErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeLobbyErr(w, http.StatusBadRequest, "invalid lobby id")
		return
	}
	err = h.Cancel.Do(r.Context(), id, uid)
	switch {
	case err == nil:
		writeLobbyJSON(w, http.StatusOK, map[string]any{
			"status": "cancelled", "lobby_id": id.String(),
		})
	case errors.Is(err, lobbyDomain.ErrNotFound):
		writeLobbyErr(w, http.StatusNotFound, "lobby not found")
	case errors.Is(err, lobbyDomain.ErrForbidden):
		writeLobbyErr(w, http.StatusForbidden, "only owner can cancel")
	case errors.Is(err, lobbyDomain.ErrClosed):
		writeLobbyErr(w, http.StatusConflict, "lobby not open")
	default:
		h.Log.ErrorContext(r.Context(), "lobby.Cancel", slog.Any("err", err))
		writeLobbyErr(w, http.StatusInternalServerError, "cancel failed")
	}
}
