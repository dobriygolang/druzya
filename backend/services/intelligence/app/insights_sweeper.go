// insights_sweeper.go — periodic SweepExpired worker for the insight
// stream.
//
// Two reasons for it to exist:
//  1. Bounded retention. Insights have an expires_at column (default
//     24h, urgent-event up to 7d). Without a sweep the table grows
//     forever even though the rows are unused after expiry.
//  2. Symmetry with MemoryRetention. Same Run/Sweep contract so wiring
//     stays predictable in bootstrap.
//
// Note we do NOT regenerate insights for inactive users on a cron. By
// design, insight production runs lazily inside GetDailyBrief.Do
// (snapshot share) — when a user opens the app, their snapshot kicks
// the generator. Cron-scheduled per-user generation would burn LLM
// quota on people who aren't there to read the result.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/intelligence/domain"
)

// InsightsSweeper deletes expired insight rows on a schedule.
type InsightsSweeper struct {
	Repo domain.InsightRepo
	Log  *slog.Logger
	// Interval — how often to sweep. 0 → 1h.
	Interval time.Duration
}

// Run blocks until ctx.Done. Spawn through Module.Background.
func (s *InsightsSweeper) Run(ctx context.Context) {
	interval := s.Interval
	if interval <= 0 {
		interval = time.Hour
	}
	// Small startup delay (mirror MemoryRetention) so the first sweep
	// doesn't fight migrations or healthchecks for the pool.
	select {
	case <-ctx.Done():
		return
	case <-time.After(45 * time.Second):
	}

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		s.sweep(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (s *InsightsSweeper) sweep(ctx context.Context) {
	if s.Repo == nil {
		return
	}
	deleted, err := s.Repo.SweepExpired(ctx)
	if err != nil {
		if s.Log != nil {
			s.Log.WarnContext(ctx, "intelligence.insights.sweep: delete failed", slog.Any("err", err))
		}
		return
	}
	if deleted > 0 && s.Log != nil {
		s.Log.InfoContext(ctx, "intelligence.insights.sweep: pruned expired rows",
			slog.Int64("deleted", deleted))
	}
}
