package domain

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrConfirmMismatch is returned when the caller's confirm_username payload
// does not match the row's username — bot/typo protection on Danger-zone
// account deletion.
var ErrConfirmMismatch = errors.New("profile: confirm username mismatch")

// AccountRepo handles user-row lifecycle outside the regular profile bundle
// path. Today only DELETE /profile/me lives here; future-merge candidates:
// shadow-ban, gdpr export trigger.
type AccountRepo interface {
	// GetUsername resolves the current username for confirmation matching.
	// Returns ErrNotFound when the row is gone.
	GetUsername(ctx context.Context, userID uuid.UUID) (string, error)
	// DeleteUser hard-deletes the users row. ON DELETE CASCADE on every
	// user-owned table (notes, whiteboards, sessions, …) cleans up the rest.
	// Returns ErrNotFound when no row matched.
	DeleteUser(ctx context.Context, userID uuid.UUID) error
}
