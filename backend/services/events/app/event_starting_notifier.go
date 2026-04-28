// event_starting_notifier.go — schedules "starts in ~10 minutes" pushes.
//
// Cadence: the worker tick every NotifierInterval (default 5 minutes) scans
// for events whose starts_at falls in (now+lower, now+upper] (default
// 10..15 min). For each (event, participant) pair it INSERTs an idempotency
// row and only if the insert won the race does it publish
// shared.EventStartingSoon onto the bus — notify subscribes there and fans
// out to telegram / web-push.
//
// The double-bucket window (5-min sweep over a 5-min look-ahead) means a
// dropped tick still fires the notification on the next sweep, while
// idempotency stops a healthy worker from double-firing across overlapping
// windows.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/events/domain"
	sharedDomain "druz9/shared/domain"
)

// Defaults; the wiring layer can override.
const (
	DefaultNotifierInterval     = 5 * time.Minute
	DefaultNotifierLowerOffset  = 10 * time.Minute
	DefaultNotifierUpperOffset  = 15 * time.Minute
	StartingSoonNotificationKind = "starting_soon"
)

// StartingSoonNotifier owns the worker.
type StartingSoonNotifier struct {
	Events   domain.EventRepo
	Ledger   domain.EventNotificationLedger
	Bus      sharedDomain.Bus
	Log      *slog.Logger
	Now      func() time.Time
	Interval time.Duration
	Lower    time.Duration
	Upper    time.Duration
}

// Run blocks until ctx.Done.
func (n *StartingSoonNotifier) Run(ctx context.Context) {
	interval := n.Interval
	if interval <= 0 {
		interval = DefaultNotifierInterval
	}
	lower := n.Lower
	if lower <= 0 {
		lower = DefaultNotifierLowerOffset
	}
	upper := n.Upper
	if upper <= lower {
		upper = DefaultNotifierUpperOffset
	}

	select {
	case <-ctx.Done():
		return
	case <-time.After(45 * time.Second):
	}

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		n.sweep(ctx, lower, upper)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (n *StartingSoonNotifier) sweep(ctx context.Context, lower, upper time.Duration) {
	candidates, err := n.Events.FindStartingSoon(ctx, lower, upper)
	if err != nil {
		if n.Log != nil {
			n.Log.WarnContext(ctx, "events.starting_soon: find failed", slog.Any("err", err))
		}
		return
	}
	if len(candidates) == 0 {
		return
	}
	now := time.Now
	if n.Now != nil {
		now = n.Now
	}
	for _, c := range candidates {
		if err := ctx.Err(); err != nil {
			return
		}
		inserted, err := n.Ledger.MarkSent(ctx, c.EventID, c.UserID, StartingSoonNotificationKind, now())
		if err != nil {
			if n.Log != nil {
				n.Log.WarnContext(ctx, "events.starting_soon: ledger MarkSent failed",
					slog.Any("err", err),
					slog.String("event_id", c.EventID.String()),
					slog.String("user_id", c.UserID.String()))
			}
			continue
		}
		if !inserted {
			continue
		}
		if n.Bus == nil {
			continue
		}
		evt := sharedDomain.EventStartingSoon{
			EventID:  c.EventID,
			UserID:   c.UserID,
			CircleID: c.CircleID,
			Title:    c.Title,
			StartsAt: c.StartsAt,
		}
		if perr := n.Bus.Publish(ctx, evt); perr != nil {
			if n.Log != nil {
				n.Log.WarnContext(ctx, "events.starting_soon: bus.Publish failed",
					slog.Any("err", perr),
					slog.String("event_id", c.EventID.String()))
			}
		}
	}
}

