// Package infra holds the Postgres adapter for the cohort bounded
// context. Domain-pure: imports cohort/domain but not pgx from any
// other service. Hand-rolled queries against migration 00030_cohorts
// + subsequent additions (denorm JOIN in ListMembers since M5,
// capacity column since 00054, etc.).
package infra

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/cohort/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.Repo.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres constructs the adapter. Caller owns the pool lifetime.
func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func (p *Postgres) Create(ctx context.Context, c domain.Cohort) (uuid.UUID, error) {
	const q = `
		INSERT INTO cohorts(id, slug, name, owner_id, starts_at, ends_at, status, visibility, capacity)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id`
	id := c.ID
	if id == uuid.Nil {
		id = uuid.New()
	}
	capacity := c.Capacity
	if capacity <= 0 {
		capacity = domain.MaxMembersPhase1
	}
	var out pgtype.UUID
	err := p.pool.QueryRow(ctx, q,
		pgUUID(id), c.Slug, c.Name, pgUUID(c.OwnerID),
		c.StartsAt, c.EndsAt, string(c.Status), string(c.Visibility), capacity,
	).Scan(&out)
	if err != nil {
		if isUniqueViolationErr(err) {
			return uuid.Nil, fmt.Errorf("cohort.Postgres.Create: slug taken: %w", domain.ErrAlreadyMember)
		}
		return uuid.Nil, fmt.Errorf("cohort.Postgres.Create: %w", err)
	}
	return fromPgUUID(out), nil
}

func (p *Postgres) GetBySlug(ctx context.Context, slug string) (domain.Cohort, error) {
	const q = `
		SELECT id, slug, name, owner_id, starts_at, ends_at, status, visibility, capacity, created_at
		  FROM cohorts WHERE slug = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, slug))
}

func (p *Postgres) Get(ctx context.Context, id uuid.UUID) (domain.Cohort, error) {
	const q = `
		SELECT id, slug, name, owner_id, starts_at, ends_at, status, visibility, capacity, created_at
		  FROM cohorts WHERE id = $1`
	return p.scanOne(p.pool.QueryRow(ctx, q, pgUUID(id)))
}

type pgRow interface {
	Scan(dest ...any) error
}

func (p *Postgres) scanOne(row pgRow) (domain.Cohort, error) {
	var (
		id, owner               pgtype.UUID
		slug, name, status, vis string
		starts, ends, created   time.Time
		capacity                int
	)
	if err := row.Scan(&id, &slug, &name, &owner, &starts, &ends, &status, &vis, &capacity, &created); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Cohort{}, domain.ErrNotFound
		}
		return domain.Cohort{}, fmt.Errorf("cohort.Postgres.scan: %w", err)
	}
	return domain.Cohort{
		ID: fromPgUUID(id), Slug: slug, Name: name,
		OwnerID:  fromPgUUID(owner),
		StartsAt: starts, EndsAt: ends,
		Status:     domain.Status(status),
		Visibility: domain.Visibility(vis),
		Capacity:   capacity,
		CreatedAt:  created,
	}, nil
}

func (p *Postgres) AddMember(ctx context.Context, m domain.CohortMember) error {
	const q = `
		INSERT INTO cohort_members(cohort_id, user_id, role, joined_at)
		VALUES ($1, $2, $3, COALESCE($4, now()))`
	var joinedAt any
	if !m.JoinedAt.IsZero() {
		joinedAt = m.JoinedAt
	}
	role := string(m.Role)
	if role == "" {
		role = string(domain.RoleMember)
	}
	if _, err := p.pool.Exec(ctx, q, pgUUID(m.CohortID), pgUUID(m.UserID), role, joinedAt); err != nil {
		if isUniqueViolationErr(err) {
			return domain.ErrAlreadyMember
		}
		return fmt.Errorf("cohort.Postgres.AddMember: %w", err)
	}
	return nil
}

func (p *Postgres) ListMembers(ctx context.Context, cohortID uuid.UUID) ([]domain.CohortMember, error) {
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
	rows, err := p.pool.Query(ctx, q, pgUUID(cohortID))
	if err != nil {
		return nil, fmt.Errorf("cohort.Postgres.ListMembers: %w", err)
	}
	defer rows.Close()
	out := make([]domain.CohortMember, 0, 8)
	for rows.Next() {
		var (
			cid, uid                      pgtype.UUID
			role                          string
			joined                        time.Time
			left                          pgtype.Timestamptz
			username, displayName, avatar string
		)
		if err := rows.Scan(&cid, &uid, &role, &joined, &left, &username, &displayName, &avatar); err != nil {
			return nil, fmt.Errorf("cohort.Postgres.ListMembers: scan: %w", err)
		}
		m := domain.CohortMember{
			CohortID:    fromPgUUID(cid),
			UserID:      fromPgUUID(uid),
			Role:        domain.Role(role),
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

func (p *Postgres) RemoveMember(ctx context.Context, cohortID, userID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx, `DELETE FROM cohort_members WHERE cohort_id=$1 AND user_id=$2`,
		pgUUID(cohortID), pgUUID(userID)); err != nil {
		return fmt.Errorf("cohort.Postgres.RemoveMember: %w", err)
	}
	return nil
}

func (p *Postgres) CountMembers(ctx context.Context, cohortID uuid.UUID) (int, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM cohort_members WHERE cohort_id=$1`,
		pgUUID(cohortID)).Scan(&n); err != nil {
		return 0, fmt.Errorf("cohort.Postgres.CountMembers: %w", err)
	}
	return n, nil
}

func (p *Postgres) HasMember(ctx context.Context, cohortID, userID uuid.UUID) (bool, error) {
	var n int
	if err := p.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM cohort_members WHERE cohort_id=$1 AND user_id=$2`,
		pgUUID(cohortID), pgUUID(userID)).Scan(&n); err != nil {
		return false, fmt.Errorf("cohort.Postgres.HasMember: %w", err)
	}
	return n > 0, nil
}

func (p *Postgres) Disband(ctx context.Context, cohortID uuid.UUID) error {
	if _, err := p.pool.Exec(ctx,
		`UPDATE cohorts SET status='cancelled' WHERE id=$1 AND status='active'`,
		pgUUID(cohortID)); err != nil {
		return fmt.Errorf("cohort.Postgres.Disband: %w", err)
	}
	return nil
}

func (p *Postgres) GetMemberRole(ctx context.Context, cohortID, userID uuid.UUID) (domain.Role, error) {
	var role string
	if err := p.pool.QueryRow(ctx,
		`SELECT role FROM cohort_members WHERE cohort_id=$1 AND user_id=$2`,
		pgUUID(cohortID), pgUUID(userID)).Scan(&role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrNotFound
		}
		return "", fmt.Errorf("cohort.Postgres.GetMemberRole: %w", err)
	}
	return domain.Role(role), nil
}

// TransferOwner rewrites cohorts.owner_id and returns the reloaded row.
// The membership-role flip for the old/new owner is done by the use
// case via UpdateMemberRole so this layer stays small.
func (p *Postgres) TransferOwner(ctx context.Context, cohortID, newOwnerID uuid.UUID) (domain.Cohort, error) {
	const q = `
		UPDATE cohorts SET owner_id = $2 WHERE id = $1
		 RETURNING id, slug, name, owner_id, starts_at, ends_at, status, visibility, capacity, created_at`
	return p.scanOne(p.pool.QueryRow(ctx, q, pgUUID(cohortID), pgUUID(newOwnerID)))
}

func (p *Postgres) UpdateMemberRole(ctx context.Context, cohortID, userID uuid.UUID, role domain.Role) error {
	tag, err := p.pool.Exec(ctx,
		`UPDATE cohort_members SET role=$3 WHERE cohort_id=$1 AND user_id=$2`,
		pgUUID(cohortID), pgUUID(userID), string(role))
	if err != nil {
		return fmt.Errorf("cohort.Postgres.UpdateMemberRole: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// UpdateMeta — partial update via COALESCE; nil patch fields preserve the
// existing column. Returns the freshly-loaded row.
func (p *Postgres) UpdateMeta(ctx context.Context, cohortID uuid.UUID, patch domain.CohortPatch) (domain.Cohort, error) {
	// Build dynamic SET clause. Hand-rolled because each combination of
	// nil/non-nil fields is a different statement.
	setParts := []string{}
	args := []any{pgUUID(cohortID)}
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
	if patch.Capacity != nil {
		args = append(args, *patch.Capacity)
		setParts = append(setParts, fmt.Sprintf("capacity = $%d", len(args)))
	}
	if len(setParts) == 0 {
		return p.Get(ctx, cohortID)
	}
	stmt := fmt.Sprintf(
		`UPDATE cohorts SET %s WHERE id = $1
		 RETURNING id, slug, name, owner_id, starts_at, ends_at, status, visibility, capacity, created_at`,
		strings.Join(setParts, ", "),
	)
	var c domain.Cohort
	var status, visibility string
	var capacity int
	row := p.pool.QueryRow(ctx, stmt, args...)
	var id, ownerID pgtype.UUID
	var startsAt, endsAt, createdAt pgtype.Timestamptz
	if err := row.Scan(&id, &c.Slug, &c.Name, &ownerID, &startsAt, &endsAt, &status, &visibility, &capacity, &createdAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Cohort{}, domain.ErrNotFound
		}
		return domain.Cohort{}, fmt.Errorf("cohort.Postgres.UpdateMeta: %w", err)
	}
	c.ID = uuid.UUID(id.Bytes)
	c.OwnerID = uuid.UUID(ownerID.Bytes)
	c.StartsAt = startsAt.Time
	c.EndsAt = endsAt.Time
	c.CreatedAt = createdAt.Time
	c.Status = domain.Status(status)
	c.Visibility = domain.Visibility(visibility)
	c.Capacity = capacity
	return c, nil
}

func (p *Postgres) ListPublic(ctx context.Context, f domain.ListFilter) (domain.ListPage, error) {
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
		return domain.ListPage{}, fmt.Errorf("cohort.Postgres.ListPublic: count: %w", err)
	}
	page := f.Page
	pageSize := f.PageSize
	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, pageSize, (page-1)*pageSize)
	orderBy := sortClause(f.Sort)
	listSQL := fmt.Sprintf(`
		SELECT c.id, c.slug, c.name, c.owner_id, c.starts_at, c.ends_at, c.status, c.visibility, c.capacity, c.created_at,
		       (SELECT COUNT(*)::int FROM cohort_members m WHERE m.cohort_id = c.id) AS members_count
		  FROM cohorts c
		 WHERE %s
		 ORDER BY %s
		 LIMIT $%d OFFSET $%d
	`, whereSQL, orderBy, len(args)+1, len(args)+2)
	rows, err := p.pool.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return domain.ListPage{}, fmt.Errorf("cohort.Postgres.ListPublic: query: %w", err)
	}
	defer rows.Close()
	out := domain.ListPage{
		Items: make([]domain.CohortWithCount, 0, pageSize),
		Total: total, Page: page, PageSize: pageSize,
	}
	for rows.Next() {
		var (
			id, owner               pgtype.UUID
			slug, name, status, vis string
			starts, ends, created   time.Time
			capacity, count         int
		)
		if scanErr := rows.Scan(&id, &slug, &name, &owner, &starts, &ends, &status, &vis, &capacity, &created, &count); scanErr != nil {
			return domain.ListPage{}, fmt.Errorf("cohort.Postgres.ListPublic: scan: %w", scanErr)
		}
		out.Items = append(out.Items, domain.CohortWithCount{
			Cohort: domain.Cohort{
				ID: fromPgUUID(id), Slug: slug, Name: name,
				OwnerID:  fromPgUUID(owner),
				StartsAt: starts, EndsAt: ends,
				Status:     domain.Status(status),
				Visibility: domain.Visibility(vis),
				Capacity:   capacity,
				CreatedAt:  created,
			},
			MembersCount: count,
		})
	}
	if len(out.Items) == 0 {
		return out, nil
	}
	// Second round-trip: top-3 members per cohort for the avatar strip.
	cohortIDs := make([]pgtype.UUID, 0, len(out.Items))
	for _, it := range out.Items {
		cohortIDs = append(cohortIDs, pgUUID(it.Cohort.ID))
	}
	const topQ = `
		WITH ranked AS (
		  SELECT m.cohort_id, m.user_id, m.role, m.joined_at,
		         COALESCE(u.username, '')::text     AS username,
		         COALESCE(u.display_name, '')::text AS display_name,
		         COALESCE(u.avatar_url, '')::text   AS avatar_url,
		         ROW_NUMBER() OVER (PARTITION BY m.cohort_id ORDER BY m.joined_at ASC) AS rn
		    FROM cohort_members m
		    LEFT JOIN users u ON u.id = m.user_id
		   WHERE m.cohort_id = ANY($1)
		)
		SELECT cohort_id, user_id, role, joined_at, username, display_name, avatar_url
		  FROM ranked
		 WHERE rn <= 3
		 ORDER BY cohort_id, rn`
	topRows, err := p.pool.Query(ctx, topQ, cohortIDs)
	if err != nil {
		return out, nil //nolint:nilerr // avatar strip is cosmetic, degrade without it
	}
	defer topRows.Close()
	byCohort := make(map[uuid.UUID][]domain.CohortMember, len(out.Items))
	for topRows.Next() {
		var (
			cid, uid                      pgtype.UUID
			role                          string
			joined                        time.Time
			username, displayName, avatar string
		)
		if scanErr := topRows.Scan(&cid, &uid, &role, &joined, &username, &displayName, &avatar); scanErr != nil {
			return out, nil //nolint:nilerr
		}
		cUUID := fromPgUUID(cid)
		byCohort[cUUID] = append(byCohort[cUUID], domain.CohortMember{
			CohortID:    cUUID,
			UserID:      fromPgUUID(uid),
			Role:        domain.Role(role),
			JoinedAt:    joined,
			Username:    username,
			DisplayName: displayName,
			AvatarURL:   avatar,
		})
	}
	for i := range out.Items {
		out.Items[i].TopMembers = byCohort[out.Items[i].Cohort.ID]
	}
	return out, nil
}

// IssueInvite — INSERT into cohort_invites. Token is generated server-side;
// max_uses=0 means unlimited.
func (p *Postgres) IssueInvite(ctx context.Context, inv domain.CohortInvite) error {
	const q = `
		INSERT INTO cohort_invites(token, cohort_id, created_by, expires_at, max_uses, used_count)
		VALUES ($1, $2, $3, $4, $5, 0)`
	var expires any
	if !inv.ExpiresAt.IsZero() {
		expires = inv.ExpiresAt
	}
	_, err := p.pool.Exec(ctx, q,
		inv.Token, pgUUID(inv.CohortID), pgUUID(inv.CreatedBy), expires, inv.MaxUses,
	)
	if err != nil {
		return fmt.Errorf("cohort.Postgres.IssueInvite: %w", err)
	}
	return nil
}

// ConsumeInvite atomically validates + increments used_count in a single
// UPDATE…WHERE so two concurrent calls race safely.
func (p *Postgres) ConsumeInvite(ctx context.Context, token string) (uuid.UUID, error) {
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
			return uuid.Nil, domain.ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("cohort.Postgres.ConsumeInvite: %w", err)
	}
	return fromPgUUID(cohortID), nil
}

// Leaderboard — sum of ratings.elo among cohort members.
func (p *Postgres) Leaderboard(ctx context.Context, cohortID uuid.UUID, _ string) ([]domain.MemberStanding, error) {
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
	rows, err := p.pool.Query(ctx, q, pgUUID(cohortID))
	if err != nil {
		return nil, fmt.Errorf("cohort.Postgres.Leaderboard: %w", err)
	}
	defer rows.Close()
	out := make([]domain.MemberStanding, 0, 8)
	for rows.Next() {
		var (
			uid  pgtype.UUID
			name string
			elo  int
		)
		if err := rows.Scan(&uid, &name, &elo); err != nil {
			return nil, fmt.Errorf("cohort.Postgres.Leaderboard: scan: %w", err)
		}
		out = append(out, domain.MemberStanding{
			UserID: fromPgUUID(uid), DisplayName: name, OverallElo: elo,
		})
	}
	return out, nil
}

// StreakHeatmap — hand-rolled CROSS-JOIN on generate_series so sqlc can't
// statically analyse. Single round-trip. See Phase 2 commit for rationale.
func (p *Postgres) StreakHeatmap(ctx context.Context, cohortID uuid.UUID, days int) ([]domain.StreakHeatmapRow, error) {
	if days <= 0 || days > 30 {
		days = 14
	}
	const q = `
WITH days AS (
  SELECT generate_series(
           (CURRENT_DATE - ($2::int - 1))::date,
           CURRENT_DATE,
           '1 day'::interval
         )::date AS d
),
members AS (
  SELECT m.user_id, COALESCE(u.username, '')::text AS username,
         COALESCE(u.display_name, '')::text AS display_name
    FROM cohort_members m
    LEFT JOIN users u ON u.id = m.user_id
   WHERE m.cohort_id = $1
)
SELECT m.user_id, m.username, m.display_name, d.d,
       (h.passed = TRUE) AS solved
  FROM members m
  CROSS JOIN days d
  LEFT JOIN daily_kata_history h
    ON h.user_id = m.user_id AND h.kata_date = d.d
 ORDER BY m.user_id, d.d`
	rows, err := p.pool.Query(ctx, q, pgUUID(cohortID), days)
	if err != nil {
		return nil, fmt.Errorf("cohort.Postgres.StreakHeatmap: %w", err)
	}
	defer rows.Close()
	out := make([]domain.StreakHeatmapRow, 0)
	var current *domain.StreakHeatmapRow
	for rows.Next() {
		var (
			uid                   pgtype.UUID
			username, displayName string
			day                   time.Time
			solved                sql.NullBool
		)
		if err := rows.Scan(&uid, &username, &displayName, &day, &solved); err != nil {
			return nil, fmt.Errorf("cohort.Postgres.StreakHeatmap: scan: %w", err)
		}
		userID := fromPgUUID(uid)
		if current == nil || current.UserID != userID {
			out = append(out, domain.StreakHeatmapRow{
				UserID:      userID,
				Username:    username,
				DisplayName: displayName,
				Days:        make([]bool, 0, days),
			})
			current = &out[len(out)-1]
		}
		current.Days = append(current.Days, solved.Valid && solved.Bool)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("cohort.Postgres.StreakHeatmap: rows: %w", err)
	}
	return out, nil
}

// sortClause — whitelist-based ORDER BY builder for ListPublic. Never
// feeds user input into the SQL text — only the enum key is consulted.
// All branches include a tie-break on c.id for deterministic pagination.
func sortClause(sort string) string {
	switch strings.ToLower(sort) {
	case "active":
		return "(c.status = 'active') DESC, c.created_at DESC, c.id ASC"
	case "fullness":
		return "(SELECT COUNT(*) FROM cohort_members m WHERE m.cohort_id = c.id) DESC, c.created_at DESC, c.id ASC"
	case "ending":
		return "c.ends_at ASC, c.id ASC"
	default:
		return "c.created_at DESC, c.id ASC"
	}
}

// isUniqueViolationErr — SQLSTATE 23505 sniff (portable across pgx versions).
func isUniqueViolationErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}
