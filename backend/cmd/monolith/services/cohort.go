// Package services — wiring for the cohort bounded context (Phase 1 MVP).
//
// Why a single file owns Postgres adapter + chi handlers:
//   - Phase 1 cohort surface is small (6 endpoints, 3 tables) — splitting it
//     across cohort/infra and cohort/ports would require pulling pgx + chi
//     into cohort/go.mod, doubling the dependency surface for negligible win.
//   - The cohort/app use cases stay pure (just need a domain.Repo) and remain
//     testable with the mock implementations under cohort/app/usecases_test.go.
//
// Endpoints (all under /api/v1):
//
//	GET    /cohort/list                  — public list (auth not required)
//	POST   /cohort                       — create (auth required)
//	GET    /cohort/{slug}                — detail by slug (auth not required)
//	POST   /cohort/{id}/join             — join by id (auth required)
//	POST   /cohort/{id}/leave            — leave by id (auth required)
//	GET    /cohort/{id}/leaderboard      — leaderboard (auth not required)
//
// Anti-fallback: leaderboard returns [] for empty cohorts; never pads with
// platform averages. 404 on unknown slug. nil-logger panics.
package services

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

	cohortApp "druz9/cohort/app"
	cohortDomain "druz9/cohort/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewCohort wires the cohort bounded context.
func NewCohort(d Deps) *Module {
	if d.Log == nil {
		panic("services.NewCohort: log is required")
	}
	repo := newCohortPostgres(d.Pool)
	create := cohortApp.NewCreateCohort(repo, d.Log)
	get := cohortApp.NewGetCohort(repo, d.Log)
	list := cohortApp.NewListCohorts(repo, d.Log)
	join := cohortApp.NewJoinCohort(repo, d.Log)
	leave := cohortApp.NewLeaveCohort(repo, d.Log)
	leaderboard := cohortApp.NewGetLeaderboard(repo, d.Log)

	h := &cohortHTTP{
		Create:      create,
		Get:         get,
		List:        list,
		Join:        join,
		Leave:       leave,
		Leaderboard: leaderboard,
		Log:         d.Log,
	}

	return &Module{
		RequireConnectAuth: false, // нет Connect surface
		MountREST: func(r chi.Router) {
			// Discovery + detail — public, без auth gate (роутер сам решает).
			r.Get("/cohort/list", h.handleList)
			r.Get("/cohort/{slug}", h.handleGetBySlug)
			r.Get("/cohort/{id}/leaderboard", h.handleLeaderboard)

			// Writes — auth required (auth gate в router.go).
			r.Post("/cohort", h.handleCreate)
			r.Post("/cohort/{id}/join", h.handleJoin)
			r.Post("/cohort/{id}/leave", h.handleLeave)
		},
	}
}

// ── Postgres adapter ──────────────────────────────────────────────────────

type cohortPostgres struct {
	pool *pgxpool.Pool
}

func newCohortPostgres(pool *pgxpool.Pool) *cohortPostgres { return &cohortPostgres{pool: pool} }

func cPgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func cFromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func (p *cohortPostgres) Create(ctx context.Context, c cohortDomain.Cohort) (uuid.UUID, error) {
	const q = `
		INSERT INTO cohorts(id, slug, name, owner_id, starts_at, ends_at, status, visibility)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id`
	id := c.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	var out pgtype.UUID
	err := p.pool.QueryRow(ctx, q,
		cPgUUID(id), c.Slug, c.Name, cPgUUID(c.OwnerID),
		c.StartsAt, c.EndsAt, string(c.Status), string(c.Visibility),
	).Scan(&out)
	if err != nil {
		if isUniqueViolationErr(err) {
			return uuid.Nil, fmt.Errorf("cohort.Postgres.Create: slug taken: %w", cohortDomain.ErrAlreadyMember)
		}
		return uuid.Nil, fmt.Errorf("cohort.Postgres.Create: %w", err)
	}
	return cFromPgUUID(out), nil
}

func (p *cohortPostgres) GetBySlug(ctx context.Context, slug string) (cohortDomain.Cohort, error) {
	const q = `
		SELECT id, slug, name, owner_id, starts_at, ends_at, status, visibility, created_at
		  FROM cohorts WHERE slug = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, slug))
}

func (p *cohortPostgres) Get(ctx context.Context, id uuid.UUID) (cohortDomain.Cohort, error) {
	const q = `
		SELECT id, slug, name, owner_id, starts_at, ends_at, status, visibility, created_at
		  FROM cohorts WHERE id = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, cPgUUID(id)))
}

type pgRow interface {
	Scan(dest ...any) error
}

func (p *cohortPostgres) scanOne(row pgRow) (cohortDomain.Cohort, error) {
	var (
		id, owner               pgtype.UUID
		slug, name, status, vis string
		starts, ends, created   time.Time
	)
	if err := row.Scan(&id, &slug, &name, &owner, &starts, &ends, &status, &vis, &created); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return cohortDomain.Cohort{}, cohortDomain.ErrNotFound
		}
		return cohortDomain.Cohort{}, fmt.Errorf("cohort.Postgres.scan: %w", err)
	}
	return cohortDomain.Cohort{
		ID: cFromPgUUID(id), Slug: slug, Name: name,
		OwnerID:  cFromPgUUID(owner),
		StartsAt: starts, EndsAt: ends,
		Status:     cohortDomain.Status(status),
		Visibility: cohortDomain.Visibility(vis),
		CreatedAt:  created,
	}, nil
}

func (p *cohortPostgres) AddMember(ctx context.Context, m cohortDomain.CohortMember) error {
	const q = `
		INSERT INTO cohort_members(cohort_id, user_id, role, joined_at)
		VALUES ($1, $2, $3, COALESCE($4, now()))`
	var joinedAt any
	if !m.JoinedAt.IsZero() {
		joinedAt = m.JoinedAt
	}
	role := string(m.Role)
	if role == "" {
		role = string(cohortDomain.RoleMember)
	}
	if _, err := p.pool.Exec(ctx, q, cPgUUID(m.CohortID), cPgUUID(m.UserID), role, joinedAt); err != nil {
		if isUniqueViolationErr(err) {
			return cohortDomain.ErrAlreadyMember
		}
		return fmt.Errorf("cohort.Postgres.AddMember: %w", err)
	}
	return nil
}

func (p *cohortPostgres) ListMembers(ctx context.Context, cohortID uuid.UUID) ([]cohortDomain.CohortMember, error) {
	const q = `
		SELECT cohort_id, user_id, role, joined_at, left_at
		  FROM cohort_members WHERE cohort_id = $1
		 ORDER BY joined_at ASC`
	rows, err := p.pool.Query(ctx, q, cPgUUID(cohortID))
	if err != nil {
		return nil, fmt.Errorf("cohort.Postgres.ListMembers: %w", err)
	}
	defer rows.Close()
	out := make([]cohortDomain.CohortMember, 0, 8)
	for rows.Next() {
		var (
			cid, uid pgtype.UUID
			role     string
			joined   time.Time
			left     pgtype.Timestamptz
		)
		if err := rows.Scan(&cid, &uid, &role, &joined, &left); err != nil {
			return nil, fmt.Errorf("cohort.Postgres.ListMembers: scan: %w", err)
		}
		m := cohortDomain.CohortMember{
			CohortID: cFromPgUUID(cid), UserID: cFromPgUUID(uid),
			Role: cohortDomain.Role(role), JoinedAt: joined,
		}
		if left.Valid {
			t := left.Time
			m.LeftAt = &t
		}
		out = append(out, m)
	}
	return out, nil
}

func (p *cohortPostgres) RemoveMember(ctx context.Context, cohortID, userID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx, `DELETE FROM cohort_members WHERE cohort_id=$1 AND user_id=$2`,
		cPgUUID(cohortID), cPgUUID(userID)); err != nil {
		return fmt.Errorf("cohort.Postgres.RemoveMember: %w", err)
	}
	return nil
}

func (p *cohortPostgres) CountMembers(ctx context.Context, cohortID uuid.UUID) (int, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM cohort_members WHERE cohort_id=$1`,
		cPgUUID(cohortID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("cohort.Postgres.CountMembers: %w", err)
	}
	return n, nil
}

func (p *cohortPostgres) HasMember(ctx context.Context, cohortID, userID uuid.UUID) (bool, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM cohort_members WHERE cohort_id=$1 AND user_id=$2`,
		cPgUUID(cohortID), cPgUUID(userID)).Scan(&n); err != nil {
		return false, fmt.Errorf("cohort.Postgres.HasMember: %w", err)
	}
	return n > 0, nil
}

func (p *cohortPostgres) Disband(ctx context.Context, cohortID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx,
		`UPDATE cohorts SET status='cancelled' WHERE id=$1 AND status='active'`,
		cPgUUID(cohortID)); err != nil {
		return fmt.Errorf("cohort.Postgres.Disband: %w", err)
	}
	return nil
}

func (p *cohortPostgres) ListPublic(ctx context.Context, f cohortDomain.ListFilter) (cohortDomain.ListPage, error) {
	whereParts := []string{"visibility = 'public'"}
	args := []any{}
	if f.Status != "" {
		args = append(args, f.Status)
		whereParts = append(whereParts, fmt.Sprintf("status = $%d", len(args)))
	}
	if f.Search != "" {
		args = append(args, "%"+strings.ToLower(f.Search)+"%")
		whereParts = append(whereParts, fmt.Sprintf("LOWER(name) LIKE $%d", len(args)))
	}
	whereSQL := strings.Join(whereParts, " AND ")
	var total int
	if err := p.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*)::int FROM cohorts WHERE %s`, whereSQL),
		args...).Scan(&total); err != nil {
		return cohortDomain.ListPage{}, fmt.Errorf("cohort.Postgres.ListPublic: count: %w", err)
	}
	page := f.Page
	pageSize := f.PageSize
	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, pageSize, (page-1)*pageSize)
	listSQL := fmt.Sprintf(`
		SELECT c.id, c.slug, c.name, c.owner_id, c.starts_at, c.ends_at, c.status, c.visibility, c.created_at,
		       (SELECT COUNT(*)::int FROM cohort_members m WHERE m.cohort_id = c.id) AS members_count
		  FROM cohorts c
		 WHERE %s
		 ORDER BY c.starts_at DESC, c.id ASC
		 LIMIT $%d OFFSET $%d
	`, whereSQL, len(args)+1, len(args)+2)
	rows, err := p.pool.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return cohortDomain.ListPage{}, fmt.Errorf("cohort.Postgres.ListPublic: query: %w", err)
	}
	defer rows.Close()
	out := cohortDomain.ListPage{
		Items: make([]cohortDomain.CohortWithCount, 0, pageSize),
		Total: total, Page: page, PageSize: pageSize,
	}
	for rows.Next() {
		var (
			id, owner               pgtype.UUID
			slug, name, status, vis string
			starts, ends, created   time.Time
			count                   int
		)
		if err := rows.Scan(&id, &slug, &name, &owner, &starts, &ends, &status, &vis, &created, &count); err != nil {
			return cohortDomain.ListPage{}, fmt.Errorf("cohort.Postgres.ListPublic: scan: %w", err)
		}
		out.Items = append(out.Items, cohortDomain.CohortWithCount{
			Cohort: cohortDomain.Cohort{
				ID: cFromPgUUID(id), Slug: slug, Name: name,
				OwnerID:  cFromPgUUID(owner),
				StartsAt: starts, EndsAt: ends,
				Status:     cohortDomain.Status(status),
				Visibility: cohortDomain.Visibility(vis),
				CreatedAt:  created,
			},
			MembersCount: count,
		})
	}
	return out, nil
}

func (p *cohortPostgres) IssueInvite(_ context.Context, _ cohortDomain.CohortInvite) error {
	// Phase 2.
	return cohortDomain.ErrNotImplemented
}

func (p *cohortPostgres) ConsumeInvite(_ context.Context, _ string) (uuid.UUID, error) {
	// Phase 2.
	return uuid.Nil, cohortDomain.ErrNotImplemented
}

// Leaderboard — внутри когорты сортируем по сумме elo (ratings.elo) среди
// её участников. weekISO Phase 1 не используется (резерв на еженедельный
// XP delta, который пока не персистится отдельно от arena_matches).
//
// Anti-fallback: empty cohort → []; никаких padding средними по платформе.
func (p *cohortPostgres) Leaderboard(ctx context.Context, cohortID uuid.UUID, _ string) ([]cohortDomain.MemberStanding, error) {
	const q = `
		WITH members AS (
		  SELECT m.user_id FROM cohort_members m WHERE m.cohort_id = $1
		),
		totals AS (
		  SELECT u.id AS user_id,
		         COALESCE(NULLIF(u.display_name,''), u.username) AS display_name,
		         COALESCE((SELECT SUM(r.elo)::int FROM ratings r WHERE r.user_id = u.id), 0) AS overall_elo
		    FROM users u
		    JOIN members ON members.user_id = u.id
		)
		SELECT user_id, display_name, overall_elo
		  FROM totals
		 ORDER BY overall_elo DESC, display_name ASC`
	rows, err := p.pool.Query(ctx, q, cPgUUID(cohortID))
	if err != nil {
		return nil, fmt.Errorf("cohort.Postgres.Leaderboard: %w", err)
	}
	defer rows.Close()
	out := make([]cohortDomain.MemberStanding, 0, 8)
	for rows.Next() {
		var (
			uid  pgtype.UUID
			name string
			elo  int
		)
		if err := rows.Scan(&uid, &name, &elo); err != nil {
			return nil, fmt.Errorf("cohort.Postgres.Leaderboard: scan: %w", err)
		}
		out = append(out, cohortDomain.MemberStanding{
			UserID: cFromPgUUID(uid), DisplayName: name, OverallElo: elo,
		})
	}
	return out, nil
}

// isUniqueViolationErr — SQLSTATE 23505 sniff, см. guild/discovery_handler.
func isUniqueViolationErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}

// ── HTTP handlers ─────────────────────────────────────────────────────────

type cohortHTTP struct {
	Create      *cohortApp.CreateCohort
	Get         *cohortApp.GetCohort
	List        *cohortApp.ListCohorts
	Join        *cohortApp.JoinCohort
	Leave       *cohortApp.LeaveCohort
	Leaderboard *cohortApp.GetLeaderboard
	Log         *slog.Logger
}

type cohortDTO struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	OwnerID      string `json:"owner_id"`
	StartsAt     string `json:"starts_at"`
	EndsAt       string `json:"ends_at"`
	Status       string `json:"status"`
	Visibility   string `json:"visibility"`
	CreatedAt    string `json:"created_at"`
	MembersCount int    `json:"members_count"`
}

func cohortToDTO(c cohortDomain.Cohort, count int) cohortDTO {
	return cohortDTO{
		ID:           c.ID.String(),
		Slug:         c.Slug,
		Name:         c.Name,
		OwnerID:      c.OwnerID.String(),
		StartsAt:     c.StartsAt.UTC().Format(time.RFC3339),
		EndsAt:       c.EndsAt.UTC().Format(time.RFC3339),
		Status:       string(c.Status),
		Visibility:   string(c.Visibility),
		CreatedAt:    c.CreatedAt.UTC().Format(time.RFC3339),
		MembersCount: count,
	}
}

func writeCohortErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"message": msg},
	})
}

// GET /cohort/list?status=&search=&page=&page_size=
func (h *cohortHTTP) handleList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("page_size"))
	f := cohortDomain.ListFilter{
		Status:   strings.TrimSpace(q.Get("status")),
		Search:   strings.TrimSpace(q.Get("search")),
		Page:     page,
		PageSize: pageSize,
	}
	out, err := h.List.Do(r.Context(), f)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.List failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "list failed")
		return
	}
	items := make([]cohortDTO, 0, len(out.Items))
	for _, c := range out.Items {
		items = append(items, cohortToDTO(c.Cohort, c.MembersCount))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"items": items, "total": out.Total, "page": out.Page, "page_size": out.PageSize,
	})
}

type createCohortReq struct {
	Slug       string `json:"slug"`
	Name       string `json:"name"`
	StartsAt   string `json:"starts_at"`
	EndsAt     string `json:"ends_at"`
	Visibility string `json:"visibility"`
}

// POST /cohort
func (h *cohortHTTP) handleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req createCohortReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCohortErr(w, http.StatusBadRequest, fmt.Sprintf("invalid body: %v", err))
		return
	}
	starts, ends := time.Now().UTC(), time.Now().UTC().Add(56*24*time.Hour)
	if req.StartsAt != "" {
		t, err := time.Parse(time.RFC3339, req.StartsAt)
		if err != nil {
			writeCohortErr(w, http.StatusBadRequest, "starts_at must be RFC3339")
			return
		}
		starts = t
	}
	if req.EndsAt != "" {
		t, err := time.Parse(time.RFC3339, req.EndsAt)
		if err != nil {
			writeCohortErr(w, http.StatusBadRequest, "ends_at must be RFC3339")
			return
		}
		ends = t
	}
	vis := cohortDomain.Visibility(req.Visibility)
	if vis == "" {
		vis = cohortDomain.VisibilityPublic
	}
	if vis != cohortDomain.VisibilityInvite && vis != cohortDomain.VisibilityPublic {
		writeCohortErr(w, http.StatusBadRequest, "visibility must be public|invite")
		return
	}
	id, err := h.Create.DoFull(r.Context(), cohortApp.CreateCohortInput{
		OwnerID: uid, Slug: req.Slug, Name: req.Name,
		StartsAt: starts, EndsAt: ends, Visibility: vis,
	})
	if err != nil {
		if errors.Is(err, cohortApp.ErrInvalidInput) {
			writeCohortErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if errors.Is(err, cohortDomain.ErrAlreadyMember) {
			writeCohortErr(w, http.StatusConflict, "slug already taken")
			return
		}
		h.Log.ErrorContext(r.Context(), "cohort.Create failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "create failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id.String()})
}

// GET /cohort/{slug}
func (h *cohortHTTP) handleGetBySlug(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	view, err := h.Get.Do(r.Context(), slug)
	if err != nil {
		if errors.Is(err, cohortDomain.ErrNotFound) {
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
			return
		}
		h.Log.ErrorContext(r.Context(), "cohort.Get failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "get failed")
		return
	}
	type memberDTO struct {
		UserID   string `json:"user_id"`
		Role     string `json:"role"`
		JoinedAt string `json:"joined_at"`
	}
	members := make([]memberDTO, 0, len(view.Members))
	for _, m := range view.Members {
		members = append(members, memberDTO{
			UserID:   m.UserID.String(),
			Role:     string(m.Role),
			JoinedAt: m.JoinedAt.UTC().Format(time.RFC3339),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"cohort":  cohortToDTO(view.Cohort, len(view.Members)),
		"members": members,
	})
}

// POST /cohort/{id}/join
func (h *cohortHTTP) handleJoin(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	err = h.Join.DoByID(r.Context(), cid, uid)
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "joined", "cohort_id": cid.String()})
	case errors.Is(err, cohortDomain.ErrNotFound):
		writeCohortErr(w, http.StatusNotFound, "cohort not found")
	case errors.Is(err, cohortDomain.ErrAlreadyMember):
		writeCohortErr(w, http.StatusConflict, "already a member")
	case errors.Is(err, cohortDomain.ErrCohortFull):
		writeCohortErr(w, http.StatusConflict, "cohort is full")
	case errors.Is(err, cohortApp.ErrInvalidInput):
		writeCohortErr(w, http.StatusBadRequest, err.Error())
	default:
		h.Log.ErrorContext(r.Context(), "cohort.Join failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "join failed")
	}
}

// POST /cohort/{id}/leave
func (h *cohortHTTP) handleLeave(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	res, err := h.Leave.Do(r.Context(), cid, uid)
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": res.Status, "cohort_id": cid.String(),
		})
	case errors.Is(err, cohortDomain.ErrNotFound):
		writeCohortErr(w, http.StatusNotFound, "not a member")
	default:
		h.Log.ErrorContext(r.Context(), "cohort.Leave failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "leave failed")
	}
}

// GET /cohort/{id}/leaderboard
func (h *cohortHTTP) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	cid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	rows, err := h.Leaderboard.Do(r.Context(), cid, "")
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.Leaderboard failed", slog.Any("err", err))
		writeCohortErr(w, http.StatusInternalServerError, "leaderboard failed")
		return
	}
	type rowDTO struct {
		UserID      string `json:"user_id"`
		DisplayName string `json:"display_name"`
		OverallElo  int    `json:"overall_elo"`
		WeeklyXP    int64  `json:"weekly_xp"`
	}
	out := make([]rowDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, rowDTO{
			UserID: r.UserID.String(), DisplayName: r.DisplayName,
			OverallElo: r.OverallElo, WeeklyXP: r.WeeklyXP,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}
