// users.go — Postgres adapters for the admin user-management surface.
//
// Listing joins users LEFT JOIN user_bans (active row) so the table can
// surface ban metadata in a single query. Ban / unban writes operate on
// `user_bans` exclusively — `users.role` and other columns are never
// touched.
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/admin/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Users is the persistence adapter for the user-management endpoints.
type Users struct {
	pool *pgxpool.Pool
}

// NewUsers wraps a pool.
func NewUsers(pool *pgxpool.Pool) *Users { return &Users{pool: pool} }

const (
	defaultUserListLimit = 25
	maxUserListLimit     = 100
)

// activeBanJoin is the LEFT JOIN snippet that surfaces the currently-active
// ban row for each user. lifted_at IS NULL means the moderator hasn't
// rescinded; expires_at > now() (or NULL) means it hasn't auto-lapsed.
const activeBanJoin = ` LEFT JOIN LATERAL (
    SELECT reason, expires_at
      FROM user_bans b
     WHERE b.user_id = u.id
       AND b.lifted_at IS NULL
       AND (b.expires_at IS NULL OR b.expires_at > now())
     ORDER BY b.issued_at DESC
     LIMIT 1
) ban ON TRUE `

// List returns a filtered, paginated page of users.
func (r *Users) List(ctx context.Context, f domain.UserListFilter) (domain.UserPage, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = defaultUserListLimit
	}
	if limit > maxUserListLimit {
		limit = maxUserListLimit
	}
	page := f.Page
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	var clauses []string
	var args []any
	argPos := func() string { return fmt.Sprintf("$%d", len(args)+1) }

	if q := strings.TrimSpace(f.Query); q != "" {
		// case-insensitive prefix match on username OR email — two binds.
		needle := strings.ToLower(q) + "%"
		p1 := argPos()
		args = append(args, needle)
		p2 := argPos()
		args = append(args, needle)
		clauses = append(clauses, fmt.Sprintf(
			"(LOWER(u.username) LIKE %s OR LOWER(COALESCE(u.email,'')) LIKE %s)", p1, p2))
	}
	switch strings.ToLower(strings.TrimSpace(f.Status)) {
	case "banned":
		clauses = append(clauses, "ban.reason IS NOT NULL")
	case "active":
		clauses = append(clauses, "ban.reason IS NULL")
	case "", "all":
		// no filter
	}

	// Always exclude guest accounts. Guests are ephemeral identities for
	// pair-coding / whiteboard share-links and never see human content;
	// the admin user list is for moderation of registered users only.
	clauses = append(clauses, "u.role != 'guest'")

	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}

	// Count
	countSQL := `SELECT COUNT(*)::bigint FROM users u` + activeBanJoin + where
	var total int64
	if err := r.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return domain.UserPage{}, fmt.Errorf("admin.Users.List: count: %w", err)
	}

	// Data
	listSQL := `SELECT u.id, u.username, COALESCE(u.email,''), COALESCE(u.display_name,''),
                       u.role, u.created_at, u.updated_at,
                       ban.reason, ban.expires_at
                  FROM users u` + activeBanJoin + where +
		fmt.Sprintf(" ORDER BY u.created_at DESC LIMIT %d OFFSET %d", limit, offset)
	rows, err := r.pool.Query(ctx, listSQL, args...)
	if err != nil {
		return domain.UserPage{}, fmt.Errorf("admin.Users.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AdminUserRow, 0)
	for rows.Next() {
		row, scanErr := scanUserRow(rows)
		if scanErr != nil {
			return domain.UserPage{}, fmt.Errorf("admin.Users.List: scan: %w", scanErr)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return domain.UserPage{}, fmt.Errorf("admin.Users.List: rows: %w", err)
	}
	return domain.UserPage{Items: out, Total: int(total), Page: page}, nil
}

// Get fetches one row + active ban projection.
func (r *Users) Get(ctx context.Context, id uuid.UUID) (domain.AdminUserRow, error) {
	row := r.pool.QueryRow(ctx, `SELECT u.id, u.username, COALESCE(u.email,''), COALESCE(u.display_name,''),
                                        u.role, u.created_at, u.updated_at,
                                        ban.reason, ban.expires_at
                                   FROM users u`+activeBanJoin+` WHERE u.id = $1`, id)
	out, err := scanUserRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AdminUserRow{}, domain.ErrUserNotFound
		}
		return domain.AdminUserRow{}, fmt.Errorf("admin.Users.Get: %w", err)
	}
	return out, nil
}

// Ban inserts a row in user_bans. The unique partial index
// uq_user_bans_active enforces "only one active ban per user" at the DB
// level — a race between two admins calling Ban concurrently is rejected
// with ErrAlreadyBanned.
func (r *Users) Ban(ctx context.Context, in domain.BanInput) (domain.AdminUserRow, error) {
	// Confirm user exists first to return a clean 404.
	if _, err := r.Get(ctx, in.UserID); err != nil {
		return domain.AdminUserRow{}, fmt.Errorf("admin.Users.Ban: %w", err)
	}
	var exp pgtype.Timestamptz
	if in.ExpiresAt != nil {
		exp = pgtype.Timestamptz{Time: in.ExpiresAt.UTC(), Valid: true}
	}
	_, err := r.pool.Exec(ctx, `INSERT INTO user_bans (user_id, reason, issued_by, expires_at)
		VALUES ($1, $2, $3, $4)`,
		in.UserID, in.Reason, in.IssuedBy, exp)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
			return domain.AdminUserRow{}, domain.ErrAlreadyBanned
		}
		return domain.AdminUserRow{}, fmt.Errorf("admin.Users.Ban: %w", err)
	}
	return r.Get(ctx, in.UserID)
}

// Unban stamps lifted_at on the active row (if any).
func (r *Users) Unban(ctx context.Context, userID, liftedBy uuid.UUID) (domain.AdminUserRow, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE user_bans
		    SET lifted_at = now(), lifted_by = $2
		  WHERE user_id = $1
		    AND lifted_at IS NULL
		    AND (expires_at IS NULL OR expires_at > now())`,
		userID, liftedBy)
	if err != nil {
		return domain.AdminUserRow{}, fmt.Errorf("admin.Users.Unban: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// No active ban — surface a clean sentinel so the ports layer can
		// decide between a 404 (user gone) and a 409 (no ban to lift).
		if _, err := r.Get(ctx, userID); err != nil {
			return domain.AdminUserRow{}, fmt.Errorf("admin.Users.Unban: %w", err)
		}
		return domain.AdminUserRow{}, domain.ErrNotBanned
	}
	return r.Get(ctx, userID)
}

// scanUserRow centralises the LEFT JOIN row decode (ban columns optional).
type rowScanner interface {
	Scan(dest ...any) error
}

func scanUserRow(r rowScanner) (domain.AdminUserRow, error) {
	var (
		out       domain.AdminUserRow
		banReason pgtype.Text
		banExp    pgtype.Timestamptz
		created   time.Time
		updated   time.Time
	)
	if err := r.Scan(&out.ID, &out.Username, &out.Email, &out.DisplayName,
		&out.Role, &created, &updated, &banReason, &banExp); err != nil {
		return domain.AdminUserRow{}, fmt.Errorf("admin.Users.scan: %w", err)
	}
	out.CreatedAt = created.UTC()
	out.UpdatedAt = updated.UTC()
	if banReason.Valid {
		out.IsBanned = true
		out.BanReason = banReason.String
	}
	if banExp.Valid {
		t := banExp.Time.UTC()
		out.BanExpiresAt = &t
	}
	return out, nil
}

// isMissingRelation reports whether err is a Postgres "undefined_table" /
// "undefined_column" error. Used by Dashboard.Snapshot to absorb queries
// against tables that don't exist yet in fresh environments.
func isMissingRelation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	switch pgErr.Code {
	case "42P01", // undefined_table
		"42703": // undefined_column
		return true
	}
	return false
}

// Compile-time assertion.
var _ domain.UserRepo = (*Users)(nil)
