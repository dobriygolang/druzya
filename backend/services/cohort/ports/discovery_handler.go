// discovery_handler.go — REST endpoints for the public cohort discovery flow:
//
//	GET    /api/v1/cohort/list?search=&tier=&page=&page_size=
//	POST   /api/v1/cohort                    — create
//	POST   /api/v1/cohort/{cohortId}/join     — join (open) or request (invite)
//	POST   /api/v1/cohort/{cohortId}/leave    — leave
//
// Same chi-handler-not-Connect rationale as streak_calendar_handler.go: each
// endpoint is a tiny REST surface tailored to the /cohort page. Adding them to
// the proto would force a regen across every Connect bundle for what is
// essentially CRUD-y plumbing. Migrating later is mechanical because the
// JSON shapes already line up with the eventual Connect message types.
//
// All four handlers require bearer auth; restAuthGate in router.go applies
// the gate. New-user flows (the user's first cohort) work because the gate
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

	"druz9/cohort/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CacheInvalidator is the subset of cohort/infra.CachedRepo used by these
// handlers to bust per-cohort + leaderboard cache entries on writes. Kept as a
// named interface (not inline) to satisfy gofmt + the codebase's wrapcheck
// rules.
type CacheInvalidator interface {
	Invalidate(ctx context.Context, cohortID uuid.UUID)
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
		panic("cohort.ports.NewDiscoveryHandler: log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	return &DiscoveryHandler{Pool: pool, Cache: cache, Log: log}
}

// ── shared response shapes ────────────────────────────────────────────────

type publicCohort struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Emblem       string `json:"emblem"`
	Description  string `json:"description"`
	Tier         string `json:"tier"`
	CohortElo    int    `json:"cohort_elo"`
	MembersCount int    `json:"members_count"`
	MaxMembers   int    `json:"max_members"`
	JoinPolicy   string `json:"join_policy"`
	IsPublic     bool   `json:"is_public"`
	WarsWon      int    `json:"wars_won"`
}

type listResponse struct {
	Items    []publicCohort `json:"items"`
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
}

// ── List ──────────────────────────────────────────────────────────────────

// HandleList serves GET /api/v1/cohort/list. Pagination is fixed-page-size,
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

	countSQL := fmt.Sprintf(`SELECT COUNT(*)::int FROM cohorts g WHERE %s`, whereSQL)
	var total int
	if err := h.Pool.QueryRow(r.Context(), countSQL, args...).Scan(&total); err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.List: count failed", slog.Any("err", err))
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
		       g.cohort_elo,
		       (SELECT COUNT(*)::int FROM cohort_members gm WHERE gm.cohort_id = g.id) AS members_count,
		       g.max_members,
		       g.join_policy,
		       g.is_public,
		       (SELECT COUNT(*)::int FROM cohort_wars gw WHERE gw.winner_id = g.id) AS wars_won
		  FROM cohorts g
		 WHERE %s
		 ORDER BY g.cohort_elo DESC, g.id ASC
		 LIMIT $%d OFFSET $%d
	`, whereSQL, len(args)+1, len(args)+2)

	rows, err := h.Pool.Query(r.Context(), listSQL, listArgs...)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.List: query failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "list failed")
		return
	}
	defer rows.Close()

	out := listResponse{Items: make([]publicCohort, 0, pageSize), Total: total, Page: page, PageSize: pageSize}
	for rows.Next() {
		var (
			id           pgtype.UUID
			name         string
			emblem       string
			description  string
			tier         string
			cohortElo    int32
			membersCount int32
			maxMembers   int32
			joinPolicy   string
			isPublic     bool
			warsWon      int32
		)
		if scanErr := rows.Scan(&id, &name, &emblem, &description, &tier, &cohortElo, &membersCount, &maxMembers, &joinPolicy, &isPublic, &warsWon); scanErr != nil {
			h.Log.ErrorContext(r.Context(), "cohort.List: scan failed", slog.Any("err", scanErr))
			writeJSONError(w, http.StatusInternalServerError, "list failed")
			return
		}
		out.Items = append(out.Items, publicCohort{
			ID:           uuidFromPg(id).String(),
			Name:         name,
			Emblem:       emblem,
			Description:  description,
			Tier:         tier,
			CohortElo:    int(cohortElo),
			MembersCount: int(membersCount),
			MaxMembers:   int(maxMembers),
			JoinPolicy:   joinPolicy,
			IsPublic:     isPublic,
			WarsWon:      int(warsWon),
		})
	}
	if rerr := rows.Err(); rerr != nil {
		h.Log.ErrorContext(r.Context(), "cohort.List: rows iter failed", slog.Any("err", rerr))
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
	// Tier is intentionally ignored on create — every cohort starts at the
	// lowest tier ("bronze"). Promotion happens automatically based on the
	// cohort's aggregate ELO.
	//
	// TODO(promotion): wire a nightly job that recomputes tier from
	// AVG(member.elo) and promotes/demotes when thresholds are crossed.
	// See domain.InitialCohortELO and tier thresholds in frontend tierFor().
	MaxMembers int    `json:"max_members"`
	JoinPolicy string `json:"join_policy"`
}

type createResponse struct {
	Cohort publicCohort `json:"cohort"`
}

// HandleCreate serves POST /api/v1/cohort. Refuses if the user is already a
// member of any cohort — the schema's UNIQUE INDEX idx_cohort_members_one_cohort
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
	// Every new cohort starts at the lowest tier — tier from the request body
	// is intentionally ignored (the field is kept for bwd-compat only).
	tier := "bronze"

	// Quick pre-check: refuse if the user already belongs to a cohort.
	var existing pgtype.UUID
	preErr := h.Pool.QueryRow(r.Context(),
		`SELECT cohort_id FROM cohort_members WHERE user_id = $1 LIMIT 1`,
		pgUUID(uid)).Scan(&existing)
	if preErr == nil && existing.Valid {
		writeJSONError(w, http.StatusConflict, "user already in a cohort")
		return
	}
	if preErr != nil && !errors.Is(preErr, pgx.ErrNoRows) {
		h.Log.ErrorContext(r.Context(), "cohort.Create: pre-check failed", slog.Any("err", preErr))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}

	tx, err := h.Pool.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Create: begin tx failed", slog.Any("err", err))
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
		INSERT INTO cohorts(owner_id, name, emblem, description, tier, cohort_elo, is_public, join_policy, max_members)
		VALUES ($1, $2, '', $3, $4, $5, TRUE, $6, $7)
		RETURNING id, COALESCE(emblem, ''), COALESCE(description, ''), cohort_elo, max_members, join_policy, is_public
	`
	insertErr := tx.QueryRow(r.Context(), insertSQL,
		pgUUID(uid),
		req.Name,
		req.Description,
		tier,
		int32(domain.InitialCohortELO),
		req.JoinPolicy,
		int32(req.MaxMembers),
	).Scan(&newID, &emblem, &descOut, &elo, &maxMem, &policy, &isPub)
	if insertErr != nil {
		if isUniqueViolation(insertErr) {
			writeJSONError(w, http.StatusConflict, "cohort name already taken")
			return
		}
		h.Log.ErrorContext(r.Context(), "cohort.Create: insert failed", slog.Any("err", insertErr))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}

	// Insert the captain membership in the same tx so the partial-write
	// scenario (cohort created, no members) is impossible.
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO cohort_members(cohort_id, user_id, role) VALUES ($1, $2, 'captain')`,
		newID, pgUUID(uid),
	); err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Create: insert membership failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "create failed")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Create: commit failed", slog.Any("err", err))
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
		Cohort: publicCohort{
			ID:           gid.String(),
			Name:         req.Name,
			Emblem:       emblem,
			Description:  descOut,
			Tier:         tier,
			CohortElo:    int(elo),
			MembersCount: 1,
			MaxMembers:   int(maxMem),
			JoinPolicy:   policy,
			IsPublic:     isPub,
		},
	})
}

// ── Join ──────────────────────────────────────────────────────────────────

type joinResponse struct {
	Status   string `json:"status"` // "joined" | "pending"
	CohortID string `json:"cohort_id"`
	Pending  bool   `json:"pending,omitempty"`
}

// HandleJoin serves POST /api/v1/cohort/{cohortId}/join.
//
// Decision matrix:
//
//	join_policy = "open"    → INSERT membership, status=joined
//	join_policy = "invite"  → STUB pending response (no requests table yet)
//	join_policy = "closed"  → 403
//
// Soft cap: refuses with 409 when the cohort's member count >= max_members.
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
	cohortID, err := uuid.Parse(chi.URLParam(r, "cohortId"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid cohort_id")
		return
	}

	// Refuse if the user already belongs to a cohort — we want a clear 409.
	var existing pgtype.UUID
	preErr := h.Pool.QueryRow(r.Context(),
		`SELECT cohort_id FROM cohort_members WHERE user_id = $1 LIMIT 1`,
		pgUUID(uid)).Scan(&existing)
	if preErr == nil && existing.Valid {
		if uuidFromPg(existing) == cohortID {
			writeJSONError(w, http.StatusConflict, "already a member")
			return
		}
		writeJSONError(w, http.StatusConflict, "user already in a cohort")
		return
	}
	if preErr != nil && !errors.Is(preErr, pgx.ErrNoRows) {
		h.Log.ErrorContext(r.Context(), "cohort.Join: pre-check failed", slog.Any("err", preErr))
		writeJSONError(w, http.StatusInternalServerError, "join failed")
		return
	}

	// Read cohort policy + member-count in a single round-trip.
	var (
		policy       string
		isPub        bool
		maxMembers   int32
		membersCount int32
	)
	err = h.Pool.QueryRow(r.Context(), `
		SELECT g.join_policy, g.is_public, g.max_members,
		       (SELECT COUNT(*)::int FROM cohort_members gm WHERE gm.cohort_id = g.id)
		  FROM cohorts g
		 WHERE g.id = $1
	`, pgUUID(cohortID)).Scan(&policy, &isPub, &maxMembers, &membersCount)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSONError(w, http.StatusNotFound, "cohort not found")
		return
	}
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Join: load policy failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "join failed")
		return
	}
	if !isPub {
		writeJSONError(w, http.StatusForbidden, "cohort is private")
		return
	}
	switch policy {
	case "closed":
		writeJSONError(w, http.StatusForbidden, "cohort is closed to new members")
		return
	case "invite":
		// STUB: invite-request inbox is Phase 5. For MVP we surface a clean
		// "pending" response so the UI can show a confirmation, and we don't
		// touch cohort_members. A future migration adds a cohort_join_requests
		// table; the API shape stays stable.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(joinResponse{
			Status: "pending", CohortID: cohortID.String(), Pending: true,
		})
		return
	case "open":
		// fallthrough to insert
	default:
		writeJSONError(w, http.StatusInternalServerError, "unknown join_policy")
		return
	}
	if membersCount >= maxMembers {
		writeJSONError(w, http.StatusConflict, "cohort is full")
		return
	}

	if _, err := h.Pool.Exec(r.Context(),
		`INSERT INTO cohort_members(cohort_id, user_id, role) VALUES ($1, $2, 'member')`,
		pgUUID(cohortID), pgUUID(uid),
	); err != nil {
		if isUniqueViolation(err) {
			writeJSONError(w, http.StatusConflict, "already a member")
			return
		}
		h.Log.ErrorContext(r.Context(), "cohort.Join: insert membership failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "join failed")
		return
	}

	if h.Cache != nil {
		h.Cache.Invalidate(r.Context(), cohortID)
		h.Cache.InvalidateUser(r.Context(), uid)
		h.Cache.InvalidateTop(r.Context())
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(joinResponse{Status: "joined", CohortID: cohortID.String()})
}

// ── Leave ─────────────────────────────────────────────────────────────────

type leaveResponse struct {
	Status   string `json:"status"`
	CohortID string `json:"cohort_id"`
}

// HandleLeave serves POST /api/v1/cohort/{cohortId}/leave.
//
// Captain rules (UX fix — previously 403'd):
//
//   - If the captain is the ONLY member → cohort is auto-deleted (cascades via
//     FK ON DELETE CASCADE on cohort_members and cohort_wars).
//   - If there are other members → captaincy is auto-transferred to the
//     longest-tenured non-captain member, then the original captain leaves.
//
// For non-captain members it's a single DELETE.
//
// Response shapes:
//
//	{ "status": "left",      "cohort_id": "..." }                            // normal leave
//	{ "status": "disbanded", "cohort_id": "..." }                            // sole captain → cohort deleted
//	{ "status": "transferred", "cohort_id": "...", "new_captain_id": "..." } // captain leave + auto-transfer
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
	cohortID, err := uuid.Parse(chi.URLParam(r, "cohortId"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid cohort_id")
		return
	}

	var role string
	err = h.Pool.QueryRow(r.Context(),
		`SELECT role FROM cohort_members WHERE cohort_id = $1 AND user_id = $2`,
		pgUUID(cohortID), pgUUID(uid)).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSONError(w, http.StatusNotFound, "not a member")
		return
	}
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Leave: load role failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "leave failed")
		return
	}

	// Captain branch — either disband (sole member) or auto-transfer.
	if role == domain.RoleCaptain {
		status, newCaptain, lerr := h.captainLeave(r.Context(), cohortID, uid)
		if lerr != nil {
			h.Log.ErrorContext(r.Context(), "cohort.Leave: captain leave failed", slog.Any("err", lerr))
			writeJSONError(w, http.StatusInternalServerError, "leave failed")
			return
		}
		if h.Cache != nil {
			h.Cache.Invalidate(r.Context(), cohortID)
			h.Cache.InvalidateUser(r.Context(), uid)
			if newCaptain != uuid.Nil {
				h.Cache.InvalidateUser(r.Context(), newCaptain)
			}
			h.Cache.InvalidateTop(r.Context())
		}
		w.Header().Set("Content-Type", "application/json")
		out := map[string]any{
			"status":    status,
			"cohort_id": cohortID.String(),
		}
		if newCaptain != uuid.Nil {
			out["new_captain_id"] = newCaptain.String()
		}
		_ = json.NewEncoder(w).Encode(out)
		return
	}

	if _, err := h.Pool.Exec(r.Context(),
		`DELETE FROM cohort_members WHERE cohort_id = $1 AND user_id = $2`,
		pgUUID(cohortID), pgUUID(uid),
	); err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Leave: delete failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "leave failed")
		return
	}

	if h.Cache != nil {
		h.Cache.Invalidate(r.Context(), cohortID)
		h.Cache.InvalidateUser(r.Context(), uid)
		h.Cache.InvalidateTop(r.Context())
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(leaveResponse{Status: "left", CohortID: cohortID.String()})
}

// captainLeave executes the captain-leave flow inside a single transaction.
//
// Returns:
//
//	("disbanded",   uuid.Nil, nil) — the captain was the sole member; the
//	                                 cohort row is deleted (cascades wipe
//	                                 cohort_members + cohort_wars).
//	("transferred", newCaptainID, nil) — captaincy moved to the
//	                                     longest-tenured remaining member
//	                                     and the original captain row is
//	                                     deleted.
//	("", uuid.Nil, err) on any DB failure.
func (h *DiscoveryHandler) captainLeave(
	ctx context.Context, cohortID, uid uuid.UUID,
) (string, uuid.UUID, error) {
	tx, err := h.Pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Pick the longest-tenured non-captain member as the heir.
	var heir pgtype.UUID
	scanErr := tx.QueryRow(ctx, `
		SELECT user_id
		  FROM cohort_members
		 WHERE cohort_id = $1 AND user_id <> $2
		 ORDER BY joined_at ASC, user_id ASC
		 LIMIT 1
	`, pgUUID(cohortID), pgUUID(uid)).Scan(&heir)

	switch {
	case errors.Is(scanErr, pgx.ErrNoRows):
		// Sole member — disband the cohort. ON DELETE CASCADE on
		// cohort_members + cohort_wars (FK to cohorts.id) handles the rest.
		if _, err := tx.Exec(ctx,
			`DELETE FROM cohorts WHERE id = $1`, pgUUID(cohortID),
		); err != nil {
			return "", uuid.Nil, fmt.Errorf("delete cohort: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return "", uuid.Nil, fmt.Errorf("commit disband: %w", err)
		}
		return "disbanded", uuid.Nil, nil

	case scanErr != nil:
		return "", uuid.Nil, fmt.Errorf("pick heir: %w", scanErr)
	}

	heirID := uuidFromPg(heir)

	// Promote heir → captain, then delete the original captain's row.
	if _, err := tx.Exec(ctx, `
		UPDATE cohort_members SET role = 'captain'
		 WHERE cohort_id = $1 AND user_id = $2
	`, pgUUID(cohortID), pgUUID(heirID)); err != nil {
		return "", uuid.Nil, fmt.Errorf("promote heir: %w", err)
	}
	// Also pin the new captain on cohorts.owner_id so downstream logic that
	// reads owner_id stays consistent.
	if _, err := tx.Exec(ctx, `
		UPDATE cohorts SET owner_id = $1 WHERE id = $2
	`, pgUUID(heirID), pgUUID(cohortID)); err != nil {
		return "", uuid.Nil, fmt.Errorf("update owner: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM cohort_members WHERE cohort_id = $1 AND user_id = $2
	`, pgUUID(cohortID), pgUUID(uid)); err != nil {
		return "", uuid.Nil, fmt.Errorf("delete captain row: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", uuid.Nil, fmt.Errorf("commit transfer: %w", err)
	}
	return "transferred", heirID, nil
}

// ── helpers ───────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func uuidFromPg(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
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
