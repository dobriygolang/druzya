// memory_retention.go — bounded-retention worker for coach_episodes.
//
// Coach memory grows unbounded by design (every Daily Brief, every QA, every
// cue-summary appends a row). Without retention the table eventually slows
// down Recall queries and inflates Postgres WAL. The worker is intentionally
// boring: once a day it deletes episodes older than RetentionWindow.
//
// We do not look at "importance" — the schema has no such column today, and
// anything older than 90 days is empirically irrelevant to the coach's
// rolling 30-day Recall window.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/intelligence/domain"
)

// DefaultRetentionWindow — episodes older than this are deleted.
const DefaultRetentionWindow = 90 * 24 * time.Hour

// MemoryRetention runs the periodic cleanup. Implements the same Run-blocks
// pattern as hone.StreakReconciler.
type MemoryRetention struct {
	Episodes domain.EpisodeRepo
	Log      *slog.Logger
	Now      func() time.Time
	// Interval — how often to sweep. 0 → 24h.
	Interval time.Duration
	// Window — episodes older than now()-Window are deleted. 0 → DefaultRetentionWindow.
	Window time.Duration
}

// Run blocks until ctx.Done. Spawn through Module.Background.
func (r *MemoryRetention) Run(ctx context.Context) {
	interval := r.Interval
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	window := r.Window
	if window <= 0 {
		window = DefaultRetentionWindow
	}

	// Slight start-up delay so the first sweep doesn't fight migrations or
	// healthchecks for the pool. Mirror hone.StreakReconciler.
	select {
	case <-ctx.Done():
		return
	case <-time.After(60 * time.Second):
	}

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		r.sweep(ctx, window)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (r *MemoryRetention) sweep(ctx context.Context, window time.Duration) {
	now := time.Now
	if r.Now != nil {
		now = r.Now
	}
	cutoff := now().UTC().Add(-window)
	deleted, err := r.Episodes.DeleteOlderThan(ctx, cutoff)
	if err != nil {
		if r.Log != nil {
			r.Log.WarnContext(ctx, "intelligence.memory.retention: delete failed",
				slog.Any("err", err),
				slog.Time("cutoff", cutoff))
		}
		return
	}
	if deleted > 0 && r.Log != nil {
		r.Log.InfoContext(ctx, "intelligence.memory.retention: pruned old episodes",
			slog.Int64("deleted", deleted),
			slog.Time("cutoff", cutoff))
	}
}
