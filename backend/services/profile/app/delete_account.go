// delete_account.go — DELETE /api/v1/profile/me confirmation flow.
// Mirror of the pre-refactor monolith inline handler:
//   - lookup actual username
//   - require body.confirm_username == actual (else ErrConfirmMismatch)
//   - hard-delete users row (cascades clean owned tables)
//
// Anti-fallback: any DB error surfaces verbatim — never silent success.
package app

import (
	"context"
	"fmt"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// DeleteAccountInput is the use-case request shape.
type DeleteAccountInput struct {
	UserID          uuid.UUID
	ConfirmUsername string
}

// DeleteAccount is the use-case.
type DeleteAccount struct {
	Repo domain.AccountRepo
}

// Run executes the confirmation flow. Returns (all wrapped — use errors.Is):
//   - domain.ErrNotFound   when the user row is missing
//   - domain.ErrConfirmMismatch when the confirmation field doesn't match
//   - wrapped error otherwise
func (uc *DeleteAccount) Run(ctx context.Context, in DeleteAccountInput) error {
	actual, err := uc.Repo.GetUsername(ctx, in.UserID)
	if err != nil {
		return fmt.Errorf("profile.DeleteAccount: %w", err)
	}
	if in.ConfirmUsername != actual {
		return domain.ErrConfirmMismatch
	}
	if err := uc.Repo.DeleteUser(ctx, in.UserID); err != nil {
		return fmt.Errorf("profile.DeleteAccount: %w", err)
	}
	return nil
}
