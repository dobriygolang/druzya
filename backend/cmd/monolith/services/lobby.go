// Package services — wiring for the Custom-Lobby bounded context (WAVE-11).
//
// This file owns:
//  1. the Postgres adapter for lobby/domain.Repo,
//  2. the cross-context arena.MatchCreator adapter (so lobby/app stays
//     unaware of arena types — it only depends on domain.MatchCreator),
//  3. the chi-direct REST handlers for /api/v1/lobby/*.
//
// Endpoints (all under /api/v1):
//
//	GET    /lobby/list?visibility=public&mode=&section=   public discovery
//	POST   /lobby                                         create (auth)
//	GET    /lobby/{id}                                    detail (public)
//	GET    /lobby/code/{code}                             code lookup (public, case-insensitive)
//	POST   /lobby/{id}/join                               (auth, 409 if full/closed)
//	POST   /lobby/{id}/leave                              (auth; owner-leave cancels)
//	POST   /lobby/{id}/start                              (auth, owner only)
//	POST   /lobby/{id}/cancel                             (auth, owner only)
//
// Anti-fallback:
//   - 4-letter A-Z code generator retries up to domain.MaxCodeRetries on UNIQUE
//     collisions and then returns ErrCodeExhausted (no silent re-keying).
//   - StartLobby refuses to flip a lobby to 'live' without a real arena_match
//     id from the MatchCreator — partial commits are explicitly rejected.
//   - nil-loggers panic in NewLobby — every dep is required.
package services

import (
	"context"
	"crypto/rand"
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
	lobbyApp "druz9/lobby/app"
	lobbyDomain "druz9/lobby/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// isUniqueViolationErr — SQLSTATE 23505 sniff.
func isUniqueViolationErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}

// NewLobby wires the Custom-Lobby bounded context.
//
// We construct a fresh arena Postgres adapter (it's stateless — just a
// thin wrapper over the shared pool) so lobby doesn't have to reach across
// to arena.NewArena's local. This keeps wiring order in bootstrap free of
// arena→lobby cycles.
func NewLobby(d Deps) *Module {
	if d.Log == nil {
		panic("services.NewLobby: log is required")
	}
	if d.Pool == nil {
		panic("services.NewLobby: pool is required")
	}
	arenaPG := arenaInfra.NewPostgres(d.Pool)
	repo := newLobbyPostgres(d.Pool, d.Log)
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

	return &Module{
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

// ── Postgres adapter ──────────────────────────────────────────────────────

type lobbyPostgres struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func newLobbyPostgres(pool *pgxpool.Pool, log *slog.Logger) *lobbyPostgres {
	if log == nil {
		panic("lobbyPostgres: nil logger")
	}
	return &lobbyPostgres{pool: pool, log: log}
}

func lobPgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func lobFromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

// generateCode returns a fresh 4-letter A-Z code. Uses crypto/rand so codes
// are not predictable — guessing-rate attacks against private lobbies stay
// at 26^4 ≈ 457k expected tries.
func generateCode() (string, error) {
	var buf [lobbyDomain.CodeLength]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", fmt.Errorf("lobby.code: rand: %w", err)
	}
	out := make([]byte, lobbyDomain.CodeLength)
	for i, b := range buf {
		out[i] = 'A' + (b % 26)
	}
	return string(out), nil
}

// Create inserts the lobby row + owner membership atomically. Generates the
// lobby code with retry-on-UNIQUE-collision up to MaxCodeRetries.
func (p *lobbyPostgres) Create(ctx context.Context, l lobbyDomain.Lobby) (lobbyDomain.Lobby, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertLobby = `
		INSERT INTO lobbies(
			id, code, owner_id, mode, section, difficulty, visibility,
			max_members, ai_allowed, time_limit_min, status,
			created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
		RETURNING code, created_at, updated_at`

	var (
		out      lobbyDomain.Lobby = l
		gotCode  string
		created  time.Time
		updated  time.Time
		attempts int
	)
	for attempts = 0; attempts < lobbyDomain.MaxCodeRetries; attempts++ {
		code, cerr := generateCode()
		if cerr != nil {
			return lobbyDomain.Lobby{}, cerr
		}
		err = tx.QueryRow(ctx, insertLobby,
			lobPgUUID(l.ID), code, lobPgUUID(l.OwnerID),
			string(l.Mode), l.Section, l.Difficulty, string(l.Visibility),
			int16(l.MaxMembers), l.AIAllowed, int16(l.TimeLimitMin), string(l.Status),
			l.CreatedAt,
		).Scan(&gotCode, &created, &updated)
		if err == nil {
			out.Code = gotCode
			out.CreatedAt = created
			out.UpdatedAt = updated
			break
		}
		if isUniqueViolationErr(err) {
			p.log.WarnContext(ctx, "lobby.pg.Create: code collision, retrying", slog.String("code", code))
			continue
		}
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: insert: %w", err)
	}
	if attempts == lobbyDomain.MaxCodeRetries {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: %w", lobbyDomain.ErrCodeExhausted)
	}

	// Owner membership row (team=1).
	if _, err := tx.Exec(ctx,
		`INSERT INTO lobby_members(lobby_id, user_id, role, team)
		 VALUES ($1,$2,'owner',1)`,
		lobPgUUID(out.ID), lobPgUUID(out.OwnerID),
	); err != nil {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: owner member: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.Create: commit: %w", err)
	}
	return out, nil
}

func (p *lobbyPostgres) Get(ctx context.Context, id uuid.UUID) (lobbyDomain.Lobby, error) {
	const q = `SELECT id, code, owner_id, mode, section, difficulty, visibility,
		              max_members, ai_allowed, time_limit_min, status, match_id,
		              created_at, updated_at
		         FROM lobbies WHERE id = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, lobPgUUID(id)))
}

func (p *lobbyPostgres) GetByCode(ctx context.Context, code string) (lobbyDomain.Lobby, error) {
	const q = `SELECT id, code, owner_id, mode, section, difficulty, visibility,
		              max_members, ai_allowed, time_limit_min, status, match_id,
		              created_at, updated_at
		         FROM lobbies WHERE code = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, strings.ToUpper(code)))
}

type lobbyRow interface {
	Scan(dest ...any) error
}

func (p *lobbyPostgres) scanOne(row lobbyRow) (lobbyDomain.Lobby, error) {
	var (
		id, owner                      pgtype.UUID
		matchID                        pgtype.UUID
		code, mode, sec, diff, vis, st string
		maxMembers, timeLimit          int16
		aiAllowed                      bool
		created, updated               time.Time
	)
	if err := row.Scan(&id, &code, &owner, &mode, &sec, &diff, &vis,
		&maxMembers, &aiAllowed, &timeLimit, &st, &matchID, &created, &updated); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return lobbyDomain.Lobby{}, lobbyDomain.ErrNotFound
		}
		return lobbyDomain.Lobby{}, fmt.Errorf("lobby.pg.scan: %w", err)
	}
	out := lobbyDomain.Lobby{
		ID: lobFromPgUUID(id), Code: code, OwnerID: lobFromPgUUID(owner),
		Mode: lobbyDomain.Mode(mode), Section: sec, Difficulty: diff,
		Visibility: lobbyDomain.Visibility(vis),
		MaxMembers: int(maxMembers), AIAllowed: aiAllowed,
		TimeLimitMin: int(timeLimit), Status: lobbyDomain.Status(st),
		CreatedAt: created, UpdatedAt: updated,
	}
	if matchID.Valid {
		mid := lobFromPgUUID(matchID)
		out.MatchID = &mid
	}
	return out, nil
}

func (p *lobbyPostgres) ListPublic(ctx context.Context, f lobbyDomain.ListFilter) ([]lobbyDomain.Lobby, error) {
	parts := []string{"visibility = $1", "status = 'open'"}
	args := []any{string(f.Visibility)}
	if f.Mode != "" {
		args = append(args, string(f.Mode))
		parts = append(parts, fmt.Sprintf("mode = $%d", len(args)))
	}
	if f.Section != "" {
		args = append(args, f.Section)
		parts = append(parts, fmt.Sprintf("section = $%d", len(args)))
	}
	args = append(args, f.Limit)
	q := fmt.Sprintf(`
		SELECT id, code, owner_id, mode, section, difficulty, visibility,
		       max_members, ai_allowed, time_limit_min, status, match_id,
		       created_at, updated_at
		  FROM lobbies
		 WHERE %s
		 ORDER BY created_at DESC
		 LIMIT $%d`, strings.Join(parts, " AND "), len(args))
	rows, err := p.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("lobby.pg.ListPublic: %w", err)
	}
	defer rows.Close()
	out := make([]lobbyDomain.Lobby, 0, f.Limit)
	for rows.Next() {
		l, err := p.scanOne(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}

func (p *lobbyPostgres) AddMember(ctx context.Context, m lobbyDomain.Member) error {
	if _, err := p.pool.Exec(ctx,
		`INSERT INTO lobby_members(lobby_id, user_id, role, team)
		 VALUES ($1,$2,$3,$4)`,
		lobPgUUID(m.LobbyID), lobPgUUID(m.UserID), string(m.Role), int16(m.Team),
	); err != nil {
		if isUniqueViolationErr(err) {
			return lobbyDomain.ErrAlreadyMember
		}
		return fmt.Errorf("lobby.pg.AddMember: %w", err)
	}
	return nil
}

func (p *lobbyPostgres) RemoveMember(ctx context.Context, lobbyID, userID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx,
		`DELETE FROM lobby_members WHERE lobby_id=$1 AND user_id=$2`,
		lobPgUUID(lobbyID), lobPgUUID(userID),
	); err != nil {
		return fmt.Errorf("lobby.pg.RemoveMember: %w", err)
	}
	return nil
}

func (p *lobbyPostgres) ListMembers(ctx context.Context, lobbyID uuid.UUID) ([]lobbyDomain.Member, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT lobby_id, user_id, role, team, joined_at
		   FROM lobby_members WHERE lobby_id=$1
		  ORDER BY joined_at ASC`,
		lobPgUUID(lobbyID),
	)
	if err != nil {
		return nil, fmt.Errorf("lobby.pg.ListMembers: %w", err)
	}
	defer rows.Close()
	out := make([]lobbyDomain.Member, 0, 4)
	for rows.Next() {
		var (
			lid, uid pgtype.UUID
			role     string
			team     int16
			joined   time.Time
		)
		if err := rows.Scan(&lid, &uid, &role, &team, &joined); err != nil {
			return nil, fmt.Errorf("lobby.pg.ListMembers: scan: %w", err)
		}
		out = append(out, lobbyDomain.Member{
			LobbyID: lobFromPgUUID(lid), UserID: lobFromPgUUID(uid),
			Role: lobbyDomain.Role(role), Team: int(team), JoinedAt: joined,
		})
	}
	return out, nil
}

func (p *lobbyPostgres) CountMembers(ctx context.Context, lobbyID uuid.UUID) (int, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM lobby_members WHERE lobby_id=$1`,
		lobPgUUID(lobbyID),
	).Scan(&n); err != nil {
		return 0, fmt.Errorf("lobby.pg.CountMembers: %w", err)
	}
	return n, nil
}

func (p *lobbyPostgres) HasMember(ctx context.Context, lobbyID, userID uuid.UUID) (bool, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM lobby_members WHERE lobby_id=$1 AND user_id=$2`,
		lobPgUUID(lobbyID), lobPgUUID(userID),
	).Scan(&n); err != nil {
		return false, fmt.Errorf("lobby.pg.HasMember: %w", err)
	}
	return n > 0, nil
}

func (p *lobbyPostgres) SetStatus(ctx context.Context, lobbyID uuid.UUID, status lobbyDomain.Status) error {
	if _, err := p.pool.Exec(ctx,
		`UPDATE lobbies SET status=$2, updated_at=now() WHERE id=$1`,
		lobPgUUID(lobbyID), string(status),
	); err != nil {
		return fmt.Errorf("lobby.pg.SetStatus: %w", err)
	}
	return nil
}

func (p *lobbyPostgres) SetMatchID(ctx context.Context, lobbyID uuid.UUID, matchID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx,
		`UPDATE lobbies SET match_id=$2, updated_at=now() WHERE id=$1`,
		lobPgUUID(lobbyID), lobPgUUID(matchID),
	); err != nil {
		return fmt.Errorf("lobby.pg.SetMatchID: %w", err)
	}
	return nil
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
