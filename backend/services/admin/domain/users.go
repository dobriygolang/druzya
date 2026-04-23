// users.go — admin user-management entities + repo contract.
//
// The admin user surface is a thin wrapper over the existing `users` table
// joined against the active row of `user_bans` (lifted_at IS NULL AND
// (expires_at IS NULL OR expires_at > now())). Bans are append-only — an
// "unban" stamps lifted_at instead of deleting the row, so we keep an
// audit trail of every moderation action.
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrUserNotFound is the canonical sentinel when a user_id cannot be
// resolved — distinct from generic ErrNotFound so the ports layer can map
// it to a 404 with a more specific message.
var ErrUserNotFound = errors.New("admin: user not found")

// ErrAlreadyBanned signals a BanUser call against a user who already has an
// active ban row. Maps to AlreadyExists at the wire layer — repeated POSTs
// must be idempotent at the caller's discretion (e.g. PUT for "extend").
var ErrAlreadyBanned = errors.New("admin: user already banned")

// ErrNotBanned signals an UnbanUser call against a user with no active ban.
var ErrNotBanned = errors.New("admin: user not banned")

// AdminUserRow is the listing projection. Mirrors the proto AdminUserRow.
type AdminUserRow struct {
	ID           uuid.UUID
	Username     string
	Email        string
	DisplayName  string
	Role         string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	IsBanned     bool
	BanReason    string
	BanExpiresAt *time.Time
}

// UserListFilter is the predicate set on GET /admin/users.
type UserListFilter struct {
	Query  string // case-insensitive prefix on username + email
	Status string // "" / "all" / "banned" / "active"
	Page   int
	Limit  int
}

// UserPage is a paginated user listing.
type UserPage struct {
	Items []AdminUserRow
	Total int
	Page  int
}

// BanInput is the create-ban payload.
type BanInput struct {
	UserID    uuid.UUID
	Reason    string
	ExpiresAt *time.Time
	IssuedBy  uuid.UUID
}

// UserRepo serves the admin user-management endpoints.
type UserRepo interface {
	List(ctx context.Context, f UserListFilter) (UserPage, error)
	Get(ctx context.Context, id uuid.UUID) (AdminUserRow, error)
	Ban(ctx context.Context, in BanInput) (AdminUserRow, error)
	Unban(ctx context.Context, userID, liftedBy uuid.UUID) (AdminUserRow, error)
}
