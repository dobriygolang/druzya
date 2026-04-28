// cleanup.go — bounded retention worker for events.
//
// We keep finished events around for two weeks so the user can find them in
// any "history" view (and so analytics can backfill rating events without a
// race). After that they're useless and just bloat the table — the worker
// deletes them once a day and the participants cascade automatically.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/events/domain"
)

// DefaultCleanupRetention — events whose end is older than this are deleted.
const DefaultCleanupRetention = 14 * 24 * time.Hour

// CleanupWorker runs the periodic deletion. Same Run-blocks pattern as
// hone.StreakReconciler / intelligence.MemoryRetention.
type CleanupWorker struct {
	Events    domain.EventRepo
	Log       *slog.Logger
	Now       func() time.Time
	Interval  time.Duration // 0 → 24h
	Retention time.Duration // 0 → DefaultCleanupRetention
}

// Run blocks until ctx.Done.
func (w *CleanupWorker) Run(ctx context.Context) {
	interval := w.Interval
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	retention := w.Retention
	if retention <= 0 {
		retention = DefaultCleanupRetention
	}

	select {
	case <-ctx.Done():
		return
	case <-time.After(90 * time.Second):
	}

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		w.sweep(ctx, retention)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (w *CleanupWorker) sweep(ctx context.Context, retention time.Duration) {
	now := time.Now
	if w.Now != nil {
		now = w.Now
	}
	cutoff := now().UTC().Add(-retention)
	deleted, err := w.Events.DeleteEndedBefore(ctx, cutoff)
	if err != nil {
		if w.Log != nil {
			w.Log.WarnContext(ctx, "events.cleanup: delete failed",
				slog.Any("err", err),
				slog.Time("cutoff", cutoff))
		}
		return
	}
	if deleted > 0 && w.Log != nil {
		w.Log.InfoContext(ctx, "events.cleanup: pruned ended events",
			slog.Int64("deleted", deleted),
			slog.Time("cutoff", cutoff))
	}
}
