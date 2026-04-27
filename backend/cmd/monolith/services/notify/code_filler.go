// code_filler.go — bridge from notify.domain.CodeFiller (the bot's
// abstraction) onto auth.domain.TelegramCodeRepo (the Redis-backed store).
// Translates the cross-domain payload type and maps auth's ErrCodeNotFound
// onto notify's ErrNotFound so the bot dispatcher can keep its single
// branching check.
//
// Lives in the notify package because it's a notify-side adapter that
// depends on auth as a downstream collaborator.
package notify

import (
	"context"
	"errors"
	"fmt"

	authDomain "druz9/auth/domain"
	notifyDomain "druz9/notify/domain"
)

type telegramCodeFillerAdapter struct{ repo authDomain.TelegramCodeRepo }

// NewTelegramCodeFillerAdapter exposes the adapter for monolith wiring.
func NewTelegramCodeFillerAdapter(repo authDomain.TelegramCodeRepo) notifyDomain.CodeFiller {
	return telegramCodeFillerAdapter{repo: repo}
}

// Fill implements notify.domain.CodeFiller.
func (a telegramCodeFillerAdapter) Fill(ctx context.Context, code string, p notifyDomain.TelegramAuthPayload) error {
	if err := a.repo.Fill(ctx, code, authDomain.TelegramPayload{
		ID:        p.ID,
		ChatID:    p.ChatID,
		FirstName: p.FirstName,
		LastName:  p.LastName,
		Username:  p.Username,
		PhotoURL:  p.PhotoURL,
		AuthDate:  p.AuthDate,
		Hash:      p.Hash,
	}); err != nil {
		if errors.Is(err, authDomain.ErrCodeNotFound) {
			return notifyDomain.ErrNotFound
		}
		return fmt.Errorf("notify.telegramCodeFillerAdapter: %w", err)
	}
	return nil
}
