package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"druz9/profile/domain"
	sharedDomain "druz9/shared/domain"
)

// xpEventSourceFromReason мапит свободный Reason от publisher'а в
// closed-set source ENUM в схеме xp_events. Reason'ы могут содержать
// субконтекст ("hone_task_done:algo") — режем по первому ':'/'_'.
// Unknown → "custom" — гарантированно валидный fallback по CHECK.
func xpEventSourceFromReason(reason string) string {
	r := strings.ToLower(strings.TrimSpace(reason))
	if r == "" {
		return "custom"
	}
	// Срезаем суффикс после ':' (e.g. "hone_task_done:algo" → "hone_task_done").
	if i := strings.IndexByte(r, ':'); i > 0 {
		r = r[:i]
	}
	switch {
	case strings.HasPrefix(r, "hone_task") || strings.HasPrefix(r, "task"):
		return "task"
	case strings.HasPrefix(r, "arena") || strings.HasPrefix(r, "match"):
		return "arena"
	case strings.HasPrefix(r, "kata") || strings.HasPrefix(r, "daily_kata") || strings.HasPrefix(r, "daily"):
		return "kata"
	case strings.HasPrefix(r, "podcast"):
		return "podcast"
	case strings.HasPrefix(r, "mock"):
		return "mock"
	case strings.HasPrefix(r, "quiz"):
		return "quiz"
	case strings.HasPrefix(r, "review"):
		return "review"
	default:
		return "custom"
	}
}

// OnUserRegistered creates default rows (profile/subscription/ai_credits/notifs).
type OnUserRegistered struct {
	Repo domain.ProfileRepo
	Log  *slog.Logger
}

// Handle implements domain.Handler.
func (h *OnUserRegistered) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.UserRegistered)
	if !ok {
		return fmt.Errorf("profile.OnUserRegistered: unexpected event %T", ev)
	}
	if err := h.Repo.EnsureDefaults(ctx, e.UserID); err != nil {
		return fmt.Errorf("profile.OnUserRegistered: ensure defaults: %w", err)
	}
	h.Log.InfoContext(ctx, "profile: defaults created", slog.Any("user_id", e.UserID))
	return nil
}

// OnXPGained applies XP and publishes LevelUp if a threshold was crossed.
type OnXPGained struct {
	Repo domain.ProfileRepo
	Bus  sharedDomain.Bus
	Log  *slog.Logger
}

// Handle implements domain.Handler.
func (h *OnXPGained) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.XPGained)
	if !ok {
		return fmt.Errorf("profile.OnXPGained: unexpected event %T", ev)
	}
	bundle, err := h.Repo.GetByUserID(ctx, e.UserID)
	if err != nil {
		return fmt.Errorf("profile.OnXPGained: load profile: %w", err)
	}
	newLevel, oldLevel, remainder := domain.ApplyXP(bundle.Profile, e.Amount)
	if err := h.Repo.ApplyXPDelta(ctx, e.UserID, e.Amount, newLevel, remainder); err != nil {
		return fmt.Errorf("profile.OnXPGained: persist: %w", err)
	}
	// Phase H audit: пишем xp_events row. Failure здесь не ломает
	// XP-credit (он уже applied через ApplyXPDelta), просто warn в лог
	// чтобы ops видел drop.
	source := xpEventSourceFromReason(e.Reason)
	if rerr := h.Repo.RecordXPEvent(ctx, e.UserID, e.Amount, source, e.SourceID); rerr != nil {
		h.Log.WarnContext(ctx, "profile.OnXPGained: audit log failed",
			slog.Any("err", rerr),
			slog.String("source", source),
			slog.String("reason", e.Reason))
	}
	if newLevel != oldLevel {
		if perr := h.Bus.Publish(ctx, sharedDomain.LevelUp{
			UserID:   e.UserID,
			LevelOld: oldLevel,
			LevelNew: newLevel,
		}); perr != nil {
			h.Log.WarnContext(ctx, "profile.OnXPGained: publish LevelUp", slog.Any("err", perr))
		}
	}
	return nil
}

