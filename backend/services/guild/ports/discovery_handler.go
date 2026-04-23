// discovery_handler.go — REST endpoints for the public guild discovery flow:
//
//	GET    /api/v1/guild/list?search=&tier=&page=&page_size=
//	POST   /api/v1/guild                    — create
//	POST   /api/v1/guild/{guildId}/join     — join (open) or request (invite)
//	POST   /api/v1/guild/{guildId}/leave    — leave
//
// Same chi-handler-not-Connect rationale as streak_calendar_handler.go: each
// endpoint is a tiny REST surface tailored to the /guild page. Adding them to
// the proto would force a regen across every Connect bundle for what is
// essentially CRUD-y plumbing. Migrating later is mechanical because the
// JSON shapes already line up with the eventual Connect message types.
//
// All four handlers require bearer auth; restAuthGate in router.go applies
// the gate. New-user flows (the user's first guild) work because the gate
// fires *after* the public allow-list check, and none of these paths is in
// that list.
//
// Storage is hand-rolled pgx — the new columns from migration 00018
// (description, tier, is_public, join_policy, max_members) aren't yet covered
// by sqlc-generated queries, and the queries are read-only one-liners that
// don't justify a full sqlc regen here.
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"druz9/guild/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CacheInvalidator is the subset of guild/infra.CachedRepo used by these
// handlers to bust per-guild + leaderboard cache entries on writes. Kept as a
// named interface (not inline) to satisfy gofmt + the codebase's wrapcheck
// rules.
type CacheInvalidator interface {
	Invalidate(ctx context.Context, guildID uuid.UUID)
	InvalidateUser(ctx context.Context, userID uuid.UUID)
	InvalidateTop(ctx context.Context)
}

// DiscoveryHandler bundles the four discovery endpoints behind a single
// http.Handler. The router demultiplexes via chi.RouteContext.
type DiscoveryHandler struct {
	Pool  *pgxpool.Pool
	Cache CacheInvalidator
	Log   *slog.Logger
}

// NewDiscoveryHandler builds the handler. log is required (anti-fallback policy).
func NewDiscoveryHandler(pool *pgxpool.Pool, cache CacheInvalidator, log *slog.Logger) *DiscoveryHandler {
	if log == nil {
		panic("guild.ports.NewDiscoveryHandler: log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	return &DiscoveryHandler{Pool: pool, Cache: cache, Log: log}
}

// ── shared response shapes ────────────────────────────────────────────────

type publicGuild struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Emblem       string `json:"emblem"`
	Description  string `json:"description"`
	Tier         string `json:"tier"`
	GuildElo     int    `json:"guild_elo"`
	MembersCount int    `json:"members_count"`
	MaxMembers   int    `json:"max_members"`
	JoinPolicy   string `json:"join_policy"`
	IsPublic     bool   `json:"is_public"`
	WarsWon      int    `json:"wars_won"`
}

type listResponse struct {
	Items    []publicGuild `json:"items"`
	Total    int           `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}

// ── List ──────────────────────────────────────────────────────────────────

// HandleList serves GET /api/v1/guild/list. Pagination is fixed-page-size,
// 1-indexed; tier filter is exact match against the new column.
func (h *DiscoveryHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("search"))
	tier := strings.TrimSpace(q.Get("tier"))
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	if pageSize < 1 || pageSize > 50 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	// Build the WHERE clause dynamically. Use sqlx-style positional args.
	whereParts := []string{"g.is_public = TRUE"}
	args := []any{}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		whereParts = append(whereParts, fmt.Sprintf("LOWER(g.name) LIKE $%d", len(args)))
	}
	if tier != "" {
		args = append(args, tier)
		whereParts = append(whereParts, fmt.Sprintf("g.tier = $%d", len(args)))
	}
	whereSQL := strings.Join(whereParts, " AND ")

	countSQL := fmt.Sprintf(`SELECT COUNT(*)::int FROM guilds g WHERE %s`, whereSQL)
	var total int
	if err := h.Pool.QueryRow(r.Context(), countSQL, args...).Scan(&total); err != nil {
		h.Log.ErrorContext(r.Context(), "guild.List: count failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "list failed")
		return
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, pageSize, offset)
	listSQL := fmt.Sprintf(`
		SELECT g.id,
		       g.name,
		       COALESCE(g.emblem, ''),
		       COALESCE(g.description, ''),
		       COALESCE(g.tier, ''),
		       g.guild_elo,
		       (SELECT COUNT(*)::int FROM guild_members gm WHERE gm.guild_id = g.id) AS members_count,
		       g.max_members,
		       g.join_policy,
		       g.is_public,
		       (SELECT COUNT(*)::int FROM guild_wars gw WHERE gw.winner_id = g.id) AS wars_won
		  FROM guilds g
		 WHERE %s
		 ORDER BY g.guild_elo DESC, g.id ASC
		 LIMIT $%d OFFSET $%d
	`, whereSQL, len(args)+1, len(args)+2)

	rows, err := h.Pool.Query(r.Context(), listSQL, listArgs...)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "guild.List: query failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "list failed")
		return
	}
	defer rows.Close()

	out := listResponse{Items: make([]publicGuild, 0, pageSize), Total: total, Page: page, PageSize: pageSize}
	for rows.Next() {
		var (
			id           pgtype.UUID
			name         string
			emblem       string
			description  string
			tier         string
			guildElo     int32
			membersCount int32
			maxMembers   int32
			joinPolicy   string
			isPublic     bool
			warsWon      int32
		)
		if scanErr := rows.Scan(&id, &name, &emblem, &description, &tier, &guildElo, &membersCount, &maxMembers, &joinPolicy, &isPublic, &warsWon); scanErr != nil {
			h.Log.ErrorContext(r.Context(), "guild.List: scan failed", slog.Any("err", scanErr))
			writeJSONError(w, http.StatusInternalServerError, "list failed")
			return
		}
		out.Items = append(out.Items, publicGuild{
			ID:           uuidFromPg(id).String(),
			Name:         name,
			Emblem:       emblem,
			Description:  description,
			Tier:         tier,
			GuildElo:     int(guildElo),
			MembersCount: int(membersCount),
			MaxMembers:   int(maxMembers),
			JoinPolicy:   joinPolicy,
			IsPublic:     isPublic,
			WarsWon:      int(warsWon),
		})
	}
	if rerr := rows.Err(); rerr != nil {
		h.Log.ErrorContext(r.Context(), "guild.List: rows iter failed", slog.Any("err", rerr))
		writeJSONError(w, http.StatusInternalServerError, "list failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=30")
	_ = json.NewEncoder(w).Encode(out)
}

// ── Create ────────────────────────────────────────────────────────────────

type createRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Tier        string `json:"tier"`
	MaxMembers  int    `json:"max_members"`
	JoinPolicy  string `json:"join_policy"`
}

type createResponse struct {
	Guild publicGuild `json:"guild"`
}

// HandleCreate serves POST /api/v1/guild. Refuses if the user is already a
// member of any guild — the schema's UNIQUE INDEX idx_guild_members_one_guild
// would also reject this at the DB layer; we check up front for a friendlier
// error message.
func (h *DiscoveryHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if l := len([]rune(req.Name)); l < 3 || l > 32 {
		writeJSONError(w, http.StatusBadRequest, "name must be 3..32 characters")
		return
	}
	req.JoinPolicy = strings.TrimSpace(req.JoinPolicy)
	if req.JoinPolicy == "" {
		req.JoinPolicy = "open"
	}
	if req.JoinPolicy != "open" && req.JoinPolicy != "invite" && req.JoinPolicy != "closed" {
		writeJSONError(w, http.StatusBadRequest, "join_policy must be open|invite|closed")
		return
	}
	if req.MaxMembers <= 0 {
		req.MaxMembers = 25
	}
	if req.MaxMembers > 200 {
		req.MaxMembers = 200
	}
	tier := strings.TrimSpace(req.Tier)
	if tier == "" {
		tier = "bronze"
	}
	if !isValidTier(tier) {
		writeJSONError(w, http.StatusBadRequest, "invalid tier")
		return
	}

	// Quick pre-check: refuse if the user already belongs to a guild.
	var existing pgtype.UUID
	preErr := h.Pool.QueryRow(r.Context(),
		`SELECT guild_id FROM guild_members WHERE user_id = $1 LIMIT 1`,
		pgUUID(uid)).Scan(&existing)
	if preErr == nil && existing.Valid {
		writeJSONError(w, http.StatusConflict, "user already in a guild")
		return
	}
	if preErr != nil && !errors.Is(preErr, pgx.ErrNoRows) {
		h.Log.ErrorContext(r.Context(), "guild.Create: pre-check failed", slog.Any("err", preErr))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}

	tx, err := h.Pool.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		h.Log.ErrorContext(r.Context(), "guild.Create: begin tx failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var (
		newID   pgtype.UUID
		emblem  string
		descOut string
		elo     int32
		maxMem  int32
		policy  string
		isPub   bool
	)
	insertSQL := `
		INSERT INTO guilds(owner_id, name, emblem, description, tier, guild_elo, is_public, join_policy, max_members)
		VALUES ($1, $2, '', $3, $4, $5, TRUE, $6, $7)
		RETURNING id, COALESCE(emblem, ''), COALESCE(description, ''), guild_elo, max_members, join_policy, is_public
	`
	insertErr := tx.QueryRow(r.Context(), insertSQL,
		pgUUID(uid),
		req.Name,
		req.Description,
		tier,
		int32(domain.InitialGuildELO),
		req.JoinPolicy,
		int32(req.MaxMembers),
	).Scan(&newID, &emblem, &descOut, &elo, &maxMem, &policy, &isPub)
	if insertErr != nil {
		if isUniqueViolation(insertErr) {
			writeJSONError(w, http.StatusConflict, "guild name already taken")
			return
		}
		h.Log.ErrorContext(r.Context(), "guild.Create: insert failed", slog.Any("err", insertErr))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}

	// Insert the captain membership in the same tx so the partial-write
	// scenario (guild created, no members) is impossible.
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO guild_members(guild_id, user_id, role) VALUES ($1, $2, 'captain')`,
		newID, pgUUID(uid),
	); err != nil {
		h.Log.ErrorContext(r.Context(), "guild.Create: insert membership failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		h.Log.ErrorContext(r.Context(), "guild.Create: commit failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}

	gid := uuidFromPg(newID)
	if h.Cache != nil {
		h.Cache.Invalidate(r.Context(), gid)
		h.Cache.InvalidateUser(r.Context(), uid)
		h.Cache.InvalidateTop(r.Context())
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(createResponse{
		Guild: publicGuild{
			ID:           gid.String(),
			Name:         req.Name,
			Emblem:       emblem,
			Description:  descOut,
			Tier:         tier,
			GuildElo:     int(elo),
			MembersCount: 1,
			MaxMembers:   int(maxMem),
			JoinPolicy:   policy,
			IsPublic:     isPub,
		},
	})
}

// ── Join ──────────────────────────────────────────────────────────────────

type joinResponse struct {
	Status  string `json:"status"` // "joined" | "pending"
	GuildID string `json:"guild_id"`
	Pending bool   `json:"pending,omitempty"`
}

// HandleJoin serves POST /api/v1/guild/{guildId}/join.
//
// Decision matrix:
//
//	join_policy = "open"    → INSERT membership, status=joined
//	join_policy = "invite"  → STUB pending response (no requests table yet)
//	join_policy = "closed"  → 403
//
// Soft cap: refuses with 409 when the guild's member count >= max_members.
func (h *DiscoveryHandler) HandleJoin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	guildID, err := uuid.Parse(chi.URLParam(r, "guildId"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid guild_id")
		return
	}

	// Refuse if the user already belongs to a guild — we want a clear 409.
	var existing pgtype.UUID
	preErr := h.Pool.QueryRow(r.Context(),
		`SELECT guild_id FROM guild_members WHERE user_id = $1 LIMIT 1`,
		pgUUID(uid)).Scan(&existing)
	if preErr == nil && existing.Valid {
		if uuidFromPg(existing) == guildID {
			writeJSONError(w, http.StatusConflict, "already a member")
			return
		}
		writeJSONError(w, http.StatusConflict, "user already in a guild")
		return
	}
	if preErr != nil && !errors.Is(preErr, pgx.ErrNoRows) {
		h.Log.ErrorContext(r.Context(), "guild.Join: pre-check failed", slog.Any("err", preErr))
		writeJSONError(w, http.StatusInternalServerError, "join failed")
		return
	}

	// Read guild policy + member-count in a single round-trip.
	var (
		policy       string
		isPub        bool
		maxMembers   int32
		membersCount int32
	)
	err = h.Pool.QueryRow(r.Context(), `
		SELECT g.join_policy, g.is_public, g.max_members,
		       (SELECT COUNT(*)::int FROM guild_members gm WHERE gm.guild_id = g.id)
		  FROM guilds g
		 WHERE g.id = $1
	`, pgUUID(guildID)).Scan(&policy, &isPub, &maxMembers, &membersCount)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSONError(w, http.StatusNotFound, "guild not found")
		return
	}
	if err != nil {
		h.Log.ErrorContext(r.Context(), "guild.Join: load policy failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "join failed")
		return
	}
	if !isPub {
		writeJSONError(w, http.StatusForbidden, "guild is private")
		return
	}
	switch policy {
	case "closed":
		writeJSONError(w, http.StatusForbidden, "guild is closed to new members")
		return
	case "invite":
		// STUB: invite-request inbox is Phase 5. For MVP we surface a clean
		// "pending" response so the UI can show a confirmation, and we don't
		// touch guild_members. A future migration adds a guild_join_requests
		// table; the API shape stays stable.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(joinResponse{
			Status: "pending", GuildID: guildID.String(), Pending: true,
		})
		return
	case "open":
		// fallthrough to insert
	default:
		writeJSONError(w, http.StatusInternalServerError, "unknown join_policy")
		return
	}
	if membersCount >= maxMembers {
		writeJSONError(w, http.StatusConflict, "guild is full")
		return
	}

	if _, err := h.Pool.Exec(r.Context(),
		`INSERT INTO guild_members(guild_id, user_id, role) VALUES ($1, $2, 'member')`,
		pgUUID(guildID), pgUUID(uid),
	); err != nil {
		if isUniqueViolation(err) {
			writeJSONError(w, http.StatusConflict, "already a member")
			return
		}
		h.Log.ErrorContext(r.Context(), "guild.Join: insert membership failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "join failed")
		return
	}

	if h.Cache != nil {
		h.Cache.Invalidate(r.Context(), guildID)
		h.Cache.InvalidateUser(r.Context(), uid)
		h.Cache.InvalidateTop(r.Context())
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(joinResponse{Status: "joined", GuildID: guildID.String()})
}

// ── Leave ─────────────────────────────────────────────────────────────────

type leaveResponse struct {
	Status  string `json:"status"`
	GuildID string `json:"guild_id"`
}

// HandleLeave serves POST /api/v1/guild/{guildId}/leave.
//
// The guild's captain cannot leave — they have to disband the guild (out of
// scope for MVP). For non-captain members it's a single DELETE.
func (h *DiscoveryHandler) HandleLeave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	guildID, err := uuid.Parse(chi.URLParam(r, "guildId"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid guild_id")
		return
	}

	var role string
	err = h.Pool.QueryRow(r.Context(),
		`SELECT role FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
		pgUUID(guildID), pgUUID(uid)).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSONError(w, http.StatusNotFound, "not a member")
		return
	}
	if err != nil {
		h.Log.ErrorContext(r.Context(), "guild.Leave: load role failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "leave failed")
		return
	}
	if role == domain.RoleCaptain {
		writeJSONError(w, http.StatusForbidden, "captain cannot leave; transfer ownership first")
		return
	}

	if _, err := h.Pool.Exec(r.Context(),
		`DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
		pgUUID(guildID), pgUUID(uid),
	); err != nil {
		h.Log.ErrorContext(r.Context(), "guild.Leave: delete failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "leave failed")
		return
	}

	if h.Cache != nil {
		h.Cache.Invalidate(r.Context(), guildID)
		h.Cache.InvalidateUser(r.Context(), uid)
		h.Cache.InvalidateTop(r.Context())
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(leaveResponse{Status: "left", GuildID: guildID.String()})
}

// ── helpers ───────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func uuidFromPg(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func isValidTier(t string) bool {
	switch t {
	case "bronze", "silver", "gold", "platinum", "diamond", "master":
		return true
	}
	return false
}

// isUniqueViolation matches Postgres SQLSTATE 23505. We avoid pulling in
// pgconn just for the constant; the textual sniff covers both wrapped and
// raw error variants.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}

// writeJSONError keeps the wire shape consistent with notify/support_handler.go
// and daily/streak_calendar_handler.go (writeJSONError there).
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}
