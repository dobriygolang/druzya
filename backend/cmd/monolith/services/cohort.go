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

// NotifyCohortBridge adapts cohort.Repo to notifyApp.CohortMembersLookup —
// notify uses it to fan-out CohortAnnouncementPosted / CohortMemberJoined /
// CohortGraduated events without directly importing cohort/domain.
type NotifyCohortBridge struct {
	Cohorts cohortDomain.Repo
}

// ListMemberIDs returns every member's user_id as a string. Errors flow
// up; notify handler short-circuits on lookup failure rather than failing.
func (b NotifyCohortBridge) ListMemberIDs(ctx context.Context, cohortID string) ([]string, error) {
	cid, err := uuid.Parse(cohortID)
	if err != nil {
		return nil, err
	}
	rows, err := b.Cohorts.ListMembers(ctx, cid)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, m := range rows {
		out = append(out, m.UserID.String())
	}
	return out, nil
}

func (b NotifyCohortBridge) GetOwnerID(ctx context.Context, cohortID string) (string, error) {
	cid, err := uuid.Parse(cohortID)
	if err != nil {
		return "", err
	}
	c, err := b.Cohorts.Get(ctx, cid)
	if err != nil {
		return "", err
	}
	return c.OwnerID.String(), nil
}

func (b NotifyCohortBridge) GetCohortName(ctx context.Context, cohortID string) (string, error) {
	cid, err := uuid.Parse(cohortID)
	if err != nil {
		return "", err
	}
	c, err := b.Cohorts.Get(ctx, cid)
	if err != nil {
		return "", err
	}
	return c.Name, nil
}

// NewCohort wires the cohort bounded context. Returns (Module, Repo) —
// the repo is needed by services that bridge into membership lookups
// (cohort_announcement uses it via CohortMembershipBridge; notify via
// NotifyCohortBridge).
func NewCohort(d Deps) (*Module, cohortDomain.Repo) {
	if d.Log == nil {
		panic("services.NewCohort: log is required")
	}
	repo := newCohortPostgres(d.Pool)
	create := cohortApp.NewCreateCohort(repo, d.Log)
	create.Bus = d.Bus
	get := cohortApp.NewGetCohort(repo, d.Log)
	list := cohortApp.NewListCohorts(repo, d.Log)
	join := cohortApp.NewJoinCohort(repo, d.Log)
	join.Bus = d.Bus
	leave := cohortApp.NewLeaveCohort(repo, d.Log)
	leaderboard := cohortApp.NewGetLeaderboard(repo, d.Log)
	update := cohortApp.NewUpdateCohort(repo, d.Log)
	disband := cohortApp.NewDisbandCohort(repo, d.Log)
	setRole := cohortApp.NewSetMemberRole(repo, d.Log)
	issueInvite := cohortApp.NewIssueInvite(repo, d.Log)
	joinByToken := cohortApp.NewJoinByToken(repo, d.Log)
	joinByToken.Bus = d.Bus
	graduate := cohortApp.NewGraduateCohort(repo, d.Bus, d.Log)

	h := &cohortHTTP{
		Create:        create,
		Get:           get,
		List:          list,
		Join:          join,
		Leave:         leave,
		Leaderboard:   leaderboard,
		Update:        update,
		Disband:       disband,
		SetMemberRole: setRole,
		IssueInvite:   issueInvite,
		JoinByToken:   joinByToken,
		Graduate:      graduate,
		Repo:          repo,
		Log:           d.Log,
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
			// M5c — owner-only moderation.
			r.Patch("/cohort/{id}", h.handleUpdate)
			r.Post("/cohort/{id}/disband", h.handleDisband)
			r.Post("/cohort/{id}/members/{userID}/role", h.handleSetMemberRole)
			// Phase-2 invite tokens.
			r.Post("/cohort/{id}/invite", h.handleIssueInvite)
			r.Post("/cohort/join/by-token", h.handleJoinByToken)
			r.Post("/cohort/{id}/graduate", h.handleGraduate)
		},
	}, repo
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
	// Denormalised JOIN with users so the catalogue UI doesn't need a
	// second round-trip per member to render @username + display name +
	// avatar (M5+; previously the response returned only user_id).
	const q = `
		SELECT m.cohort_id, m.user_id, m.role, m.joined_at, m.left_at,
		       COALESCE(u.username, '')::text     AS username,
		       COALESCE(u.display_name, '')::text AS display_name,
		       COALESCE(u.avatar_url, '')::text   AS avatar_url
		  FROM cohort_members m
		  LEFT JOIN users u ON u.id = m.user_id
		 WHERE m.cohort_id = $1
		 ORDER BY m.joined_at ASC`
	rows, err := p.pool.Query(ctx, q, cPgUUID(cohortID))
	if err != nil {
		return nil, fmt.Errorf("cohort.Postgres.ListMembers: %w", err)
	}
	defer rows.Close()
	out := make([]cohortDomain.CohortMember, 0, 8)
	for rows.Next() {
		var (
			cid, uid                       pgtype.UUID
			role                           string
			joined                         time.Time
			left                           pgtype.Timestamptz
			username, displayName, avatar  string
		)
		if err := rows.Scan(&cid, &uid, &role, &joined, &left, &username, &displayName, &avatar); err != nil {
			return nil, fmt.Errorf("cohort.Postgres.ListMembers: scan: %w", err)
		}
		m := cohortDomain.CohortMember{
			CohortID:    cFromPgUUID(cid),
			UserID:      cFromPgUUID(uid),
			Role:        cohortDomain.Role(role),
			JoinedAt:    joined,
			Username:    username,
			DisplayName: displayName,
			AvatarURL:   avatar,
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

func (p *cohortPostgres) GetMemberRole(ctx context.Context, cohortID, userID uuid.UUID) (cohortDomain.Role, error) {
	var role string
	if err := p.pool.QueryRow(ctx,
		`SELECT role FROM cohort_members WHERE cohort_id=$1 AND user_id=$2`,
		cPgUUID(cohortID), cPgUUID(userID)).Scan(&role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", cohortDomain.ErrNotFound
		}
		return "", fmt.Errorf("cohort.Postgres.GetMemberRole: %w", err)
	}
	return cohortDomain.Role(role), nil
}

func (p *cohortPostgres) UpdateMemberRole(ctx context.Context, cohortID, userID uuid.UUID, role cohortDomain.Role) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE cohort_members SET role=$3 WHERE cohort_id=$1 AND user_id=$2`,
		cPgUUID(cohortID), cPgUUID(userID), string(role))
	if err != nil {
		return fmt.Errorf("cohort.Postgres.UpdateMemberRole: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return cohortDomain.ErrNotFound
	}
	return nil
}

// UpdateMeta — partial update via COALESCE; nil patch fields preserve the
// existing column. Returns the freshly-loaded row.
func (p *cohortPostgres) UpdateMeta(ctx context.Context, cohortID uuid.UUID, patch cohortDomain.CohortPatch) (cohortDomain.Cohort, error) {
	// Build dynamic SET clause. Hand-rolled because each combination of
	// nil/non-nil fields is a different statement.
	setParts := []string{}
	args := []any{cPgUUID(cohortID)}
	if patch.Name != nil {
		args = append(args, *patch.Name)
		setParts = append(setParts, fmt.Sprintf("name = $%d", len(args)))
	}
	if patch.EndsAt != nil {
		args = append(args, patch.EndsAt.UTC())
		setParts = append(setParts, fmt.Sprintf("ends_at = $%d", len(args)))
	}
	if patch.Visibility != nil {
		args = append(args, string(*patch.Visibility))
		setParts = append(setParts, fmt.Sprintf("visibility = $%d", len(args)))
	}
	if patch.Status != nil {
		args = append(args, string(*patch.Status))
		setParts = append(setParts, fmt.Sprintf("status = $%d", len(args)))
	}
	if len(setParts) == 0 {
		// Nothing to do — return current row.
		return p.Get(ctx, cohortID)
	}
	sql := fmt.Sprintf(
		`UPDATE cohorts SET %s WHERE id = $1
		 RETURNING id, slug, name, owner_id, starts_at, ends_at, status, visibility, created_at`,
		strings.Join(setParts, ", "),
	)
	var c cohortDomain.Cohort
	var status, visibility string
	row := p.pool.QueryRow(ctx, sql, args...)
	var id, ownerID pgtype.UUID
	var startsAt, endsAt, createdAt pgtype.Timestamptz
	if err := row.Scan(&id, &c.Slug, &c.Name, &ownerID, &startsAt, &endsAt, &status, &visibility, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return cohortDomain.Cohort{}, cohortDomain.ErrNotFound
		}
		return cohortDomain.Cohort{}, fmt.Errorf("cohort.Postgres.UpdateMeta: %w", err)
	}
	c.ID = uuid.UUID(id.Bytes)
	c.OwnerID = uuid.UUID(ownerID.Bytes)
	c.StartsAt = startsAt.Time
	c.EndsAt = endsAt.Time
	c.CreatedAt = createdAt.Time
	c.Status = cohortDomain.Status(status)
	c.Visibility = cohortDomain.Visibility(visibility)
	return c, nil
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

// IssueInvite (Phase 2) — INSERT into cohort_invites. Token is generated
// server-side; max_uses=0 means unlimited.
func (p *cohortPostgres) IssueInvite(ctx context.Context, inv cohortDomain.CohortInvite) error {
	const q = `
		INSERT INTO cohort_invites(token, cohort_id, created_by, expires_at, max_uses, used_count)
		VALUES ($1, $2, $3, $4, $5, 0)`
	var expires any
	if !inv.ExpiresAt.IsZero() {
		expires = inv.ExpiresAt
	}
	_, err := p.pool.Exec(ctx, q,
		inv.Token, cPgUUID(inv.CohortID), cPgUUID(inv.CreatedBy), expires, inv.MaxUses,
	)
	if err != nil {
		return fmt.Errorf("cohort.Postgres.IssueInvite: %w", err)
	}
	return nil
}

// ConsumeInvite (Phase 2) — atomically validates + increments used_count
// in a single UPDATE…WHERE so two concurrent calls race safely. Returns
// the cohort_id on success, ErrNotFound on missing/expired/exhausted.
func (p *cohortPostgres) ConsumeInvite(ctx context.Context, token string) (uuid.UUID, error) {
	const q = `
		UPDATE cohort_invites
		   SET used_count = used_count + 1
		 WHERE token = $1
		   AND (expires_at IS NULL OR expires_at > now())
		   AND (max_uses = 0 OR used_count < max_uses)
		RETURNING cohort_id`
	var cohortID pgtype.UUID
	if err := p.pool.QueryRow(ctx, q, token).Scan(&cohortID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, cohortDomain.ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("cohort.Postgres.ConsumeInvite: %w", err)
	}
	return cFromPgUUID(cohortID), nil
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
	Create        *cohortApp.CreateCohort
	Get           *cohortApp.GetCohort
	List          *cohortApp.ListCohorts
	Join          *cohortApp.JoinCohort
	Leave         *cohortApp.LeaveCohort
	Leaderboard   *cohortApp.GetLeaderboard
	Update        *cohortApp.UpdateCohort
	Disband       *cohortApp.DisbandCohort
	SetMemberRole *cohortApp.SetMemberRole
	IssueInvite   *cohortApp.IssueInvite
	JoinByToken   *cohortApp.JoinByToken
	Graduate      *cohortApp.GraduateCohort
	// Repo — direct access to the underlying cohort.Repo for cross-cutting
	// reads (e.g. HasMember in handleList) that don't justify a use case.
	Repo cohortDomain.Repo
	Log  *slog.Logger
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
	// IsMember is true when the authenticated caller is in this cohort
	// (any role). Always false for anonymous reads — public catalogue.
	// Populated only by handleList when an auth context is present.
	IsMember bool `json:"is_member"`
	// Capacity is the soft cap from cohortDomain.MaxMembersPhase1; surfaced
	// here so the catalogue UI doesn't hard-code "/50" client-side.
	Capacity int `json:"capacity"`
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
		Capacity:     cohortDomain.MaxMembersPhase1,
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
	// Resolve membership only when the caller is authed — anonymous reads
	// stay cheap (one query per page) and IsMember falls back to false.
	uid, authed := sharedMw.UserIDFromContext(r.Context())
	items := make([]cohortDTO, 0, len(out.Items))
	for _, c := range out.Items {
		dto := cohortToDTO(c.Cohort, c.MembersCount)
		if authed {
			has, err := h.Repo.HasMember(r.Context(), c.Cohort.ID, uid)
			if err == nil {
				dto.IsMember = has
			}
			// On HasMember error we leave IsMember=false rather than failing
			// the listing — the «ТЫ»-chip just doesn't render that row.
		}
		items = append(items, dto)
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
		UserID      string `json:"user_id"`
		Role        string `json:"role"`
		JoinedAt    string `json:"joined_at"`
		Username    string `json:"username,omitempty"`
		DisplayName string `json:"display_name,omitempty"`
		AvatarURL   string `json:"avatar_url,omitempty"`
	}
	members := make([]memberDTO, 0, len(view.Members))
	for _, m := range view.Members {
		members = append(members, memberDTO{
			UserID:      m.UserID.String(),
			Role:        string(m.Role),
			JoinedAt:    m.JoinedAt.UTC().Format(time.RFC3339),
			Username:    m.Username,
			DisplayName: m.DisplayName,
			AvatarURL:   m.AvatarURL,
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

// ── M5c handlers ──────────────────────────────────────────────────────────

type updateCohortReq struct {
	Name       *string `json:"name,omitempty"`
	EndsAt     *string `json:"ends_at,omitempty"`
	Visibility *string `json:"visibility,omitempty"`
}

// PATCH /cohort/{id}
func (h *cohortHTTP) handleUpdate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	var req updateCohortReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	in := cohortApp.UpdateCohortInput{CohortID: cohortID, ActorID: uid, Name: req.Name}
	if req.EndsAt != nil && *req.EndsAt != "" {
		t, err := time.Parse(time.RFC3339, *req.EndsAt)
		if err != nil {
			writeCohortErr(w, http.StatusBadRequest, "invalid ends_at")
			return
		}
		in.EndsAt = &t
	}
	if req.Visibility != nil && *req.Visibility != "" {
		v := cohortDomain.Visibility(*req.Visibility)
		in.Visibility = &v
	}
	out, err := h.Update.Do(r.Context(), in)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortApp.ErrInvalidName),
			errors.Is(err, cohortApp.ErrInvalidEnd),
			errors.Is(err, cohortApp.ErrInvalidVisibility):
			writeCohortErr(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.Update", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "update failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cohortToDTO(out, 0))
}

// POST /cohort/{id}/disband
func (h *cohortHTTP) handleDisband(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	if err := h.Disband.Do(r.Context(), cohortID, uid); err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.Disband", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "disband failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "disbanded", "cohort_id": cohortID.String()})
}

type setRoleReq struct {
	Role string `json:"role"`
}

// POST /cohort/{id}/members/{userID}/role
func (h *cohortHTTP) handleSetMemberRole(w http.ResponseWriter, r *http.Request) {
	actorID, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	targetID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body setRoleReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.SetMemberRole.Do(r.Context(), cohortID, actorID, targetID, cohortDomain.Role(body.Role)); err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortApp.ErrInvalidRole):
			writeCohortErr(w, http.StatusBadRequest, "invalid role")
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "membership not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.SetMemberRole", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "role update failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok"})
}

// ── Phase-2 invite-token handlers (Task B) ────────────────────────────────

type issueInviteReq struct {
	MaxUses    int    `json:"max_uses"`    // 0 = unlimited
	TTLSeconds int    `json:"ttl_seconds"` // 0 = never expires
}

type issueInviteResp struct {
	Token     string `json:"token"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

// POST /cohort/{id}/invite
func (h *cohortHTTP) handleIssueInvite(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	var req issueInviteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	ttl := time.Duration(req.TTLSeconds) * time.Second
	token, err := h.IssueInvite.Do(r.Context(), cohortID, uid, req.MaxUses, ttl)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "must be coach or owner")
		case errors.Is(err, cohortApp.ErrInvalidMaxUses):
			writeCohortErr(w, http.StatusBadRequest, err.Error())
		default:
			h.Log.ErrorContext(r.Context(), "cohort.IssueInvite", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "issue failed")
		}
		return
	}
	out := issueInviteResp{Token: token, URL: "/c/join/" + token}
	if ttl > 0 {
		out.ExpiresAt = time.Now().Add(ttl).UTC().Format(time.RFC3339)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

type joinByTokenReq struct {
	Token string `json:"token"`
}

// POST /cohort/join/by-token
func (h *cohortHTTP) handleJoinByToken(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req joinByTokenReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	cohortID, err := h.JoinByToken.Do(r.Context(), req.Token, uid)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrInvalidToken):
			writeCohortErr(w, http.StatusGone, "invite expired or invalid")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.JoinByToken", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "join failed")
		}
		return
	}
	// Look up the cohort slug so the frontend can navigate without
	// asking for /cohort/{id} → /cohort/{slug} mapping.
	c, err := h.Repo.Get(r.Context(), cohortID)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "cohort.JoinByToken: load slug", slog.Any("err", err))
		// Degrade — still return cohort_id; the page can fall back to /cohorts.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "joined", "cohort_id": cohortID.String()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":    "joined",
		"cohort_id": cohortID.String(),
		"slug":      c.Slug,
	})
}

// POST /cohort/{id}/graduate
func (h *cohortHTTP) handleGraduate(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeCohortErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cohortID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeCohortErr(w, http.StatusBadRequest, "invalid cohort id")
		return
	}
	out, err := h.Graduate.Do(r.Context(), cohortID, uid)
	if err != nil {
		switch {
		case errors.Is(err, cohortApp.ErrForbidden):
			writeCohortErr(w, http.StatusForbidden, "owner-only")
		case errors.Is(err, cohortDomain.ErrNotFound):
			writeCohortErr(w, http.StatusNotFound, "cohort not found")
		default:
			h.Log.ErrorContext(r.Context(), "cohort.Graduate", slog.Any("err", err))
			writeCohortErr(w, http.StatusInternalServerError, "graduate failed")
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cohortToDTO(out, 0))
}
