package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/auth/domain"

	"github.com/google/uuid"
)

// Logout invalidates the refresh session. The access token remains technically
// valid until it expires (<=15m); clients are expected to drop it immediately.
type Logout struct {
	Sessions domain.SessionRepo
}

// Do deletes the session row. Missing session is treated as already-logged-out.
func (uc *Logout) Do(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	sid, err := uuid.Parse(refreshToken)
	if err != nil {
		// Malformed cookie — treat as logged out, no reason to 400 the user.
		return nil
	}
	if err := uc.Sessions.Delete(ctx, sid); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil
		}
		return fmt.Errorf("auth.Logout: delete session: %w", err)
	}
	return nil
}
