package app

import (
	"context"
	"fmt"
	"log/slog"

	sharedDomain "druz9/shared/domain"
)

// OnDailyKataCompleted translates kata completion into an XPGained event for
// the profile domain to consume. This keeps the domain boundary clean: daily
// never touches profiles; it just announces the XP.
type OnDailyKataCompleted struct {
	Bus sharedDomain.Bus
	Log *slog.Logger
}

// Handle implements domain.Handler.
func (h *OnDailyKataCompleted) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataCompleted)
	if !ok {
		return fmt.Errorf("daily.OnDailyKataCompleted: unexpected event %T", ev)
	}
	reason := "daily_kata"
	if e.IsCursed {
		reason = "daily_kata_cursed"
	}
	if err := h.Bus.Publish(ctx, sharedDomain.XPGained{
		UserID: e.UserID,
		Amount: e.XPEarned,
		Reason: reason,
	}); err != nil {
		return fmt.Errorf("daily.OnDailyKataCompleted: publish XPGained: %w", err)
	}
	return nil
}
