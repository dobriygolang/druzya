// Package app contains the notify use cases: SendNotification (the core
// pipeline), preference getters/setters, and the event handlers that bridge
// the shared bus into outbound notifications.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/notify/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// SendNotification is the core use case: load prefs → gate → render → enqueue.
// The actual delivery happens asynchronously in the worker (see worker.go).
type SendNotification struct {
	Prefs     domain.PreferencesRepo
	Logs      domain.LogRepo
	Templates domain.TemplateStore
	Queue     domain.Queue
	Users     domain.UserLookup
	Log       *slog.Logger
	Now       func() time.Time
}

// Input is the caller-supplied parameters. Payload is the template params bag.
type SendInput struct {
	UserID  uuid.UUID
	Type    enums.NotificationType
	Payload map[string]any
	// Force bypasses quiet hours — only MatchFound uses this today.
	Force bool
}

// Do runs the pipeline. Non-fatal skips (opt-out, quiet hours, dedup, no chat)
// are logged at info level and return nil — the caller should NOT treat them
// as errors.
func (uc *SendNotification) Do(ctx context.Context, in SendInput) error {
	now := uc.now()

	pref, err := uc.Prefs.Get(ctx, in.UserID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return fmt.Errorf("notify.SendNotification: prefs: %w", err)
	}
	if errors.Is(err, domain.ErrNotFound) {
		pref = domain.DefaultPreferences()
		pref.UserID = in.UserID
	}

	// Dedup lookup.
	recent, err := uc.Logs.RecentByType(ctx, in.UserID, in.Type, now.Add(-domain.DefaultDedupWindow))
	if err != nil {
		return fmt.Errorf("notify.SendNotification: recent: %w", err)
	}
	var lastSent *time.Time
	if len(recent) > 0 && recent[0].SentAt != nil {
		lastSent = recent[0].SentAt
	}

	force := in.Force || domain.MustForceDelivery(in.Type)
	ok, reason := domain.ShouldNotify(pref, in.Type, now, lastSent, force)
	if !ok {
		uc.Log.InfoContext(ctx, "notify.skip",
			slog.String("user_id", in.UserID.String()),
			slog.String("type", string(in.Type)),
			slog.String("reason", reason))
		return nil
	}

	channel, ok := domain.PickChannel(pref)
	if !ok {
		uc.Log.InfoContext(ctx, "notify.skip",
			slog.String("user_id", in.UserID.String()),
			slog.String("type", string(in.Type)),
			slog.String("reason", "no_channel"))
		return nil
	}

	locale, _ := uc.Users.GetLocale(ctx, in.UserID)
	if locale == "" {
		locale = "ru"
	}

	n := domain.Notification{
		ID:            uuid.New(),
		UserID:        in.UserID,
		Type:          in.Type,
		Channel:       channel,
		Locale:        locale,
		Payload:       in.Payload,
		CreatedAt:     now,
		ForceDelivery: force,
	}
	if err := uc.Queue.Enqueue(ctx, n); err != nil {
		return fmt.Errorf("notify.SendNotification: enqueue: %w", err)
	}
	uc.Log.InfoContext(ctx, "notify.enqueued",
		slog.String("id", n.ID.String()),
		slog.String("user_id", in.UserID.String()),
		slog.String("type", string(in.Type)),
		slog.String("channel", string(channel)),
	)
	return nil
}

func (uc *SendNotification) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}
