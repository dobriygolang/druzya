// cleanup_runner.go — periodic retention pass for tables that grow
// unbounded if left alone. Runs once per CleanupConfig.Interval as a
// single goroutine; each pass executes the individual sweeps in
// sequence and logs row counts. Failures in one sweep never abort the
// others.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/admin/domain"
)

// CleanupConfig — tuning knobs. Zero values use sane defaults so callers
// can `&CleanupConfig{}` and not think about it.
type CleanupConfig struct {
	YjsUpdatesRetention    time.Duration // default 90d
	CopilotMessagesRetent  time.Duration // default 1y
	PipelineAttemptsRetent time.Duration // default 2y
	Interval               time.Duration // default 1h
	SweepTimeoutEach       time.Duration // default 30s
}

func (c CleanupConfig) withDefaults() CleanupConfig {
	if c.YjsUpdatesRetention == 0 {
		c.YjsUpdatesRetention = 90 * 24 * time.Hour
	}
	if c.CopilotMessagesRetent == 0 {
		c.CopilotMessagesRetent = 365 * 24 * time.Hour
	}
	if c.PipelineAttemptsRetent == 0 {
		c.PipelineAttemptsRetent = 2 * 365 * 24 * time.Hour
	}
	if c.Interval == 0 {
		c.Interval = time.Hour
	}
	if c.SweepTimeoutEach == 0 {
		c.SweepTimeoutEach = 30 * time.Second
	}
	return c
}

// CleanupRunner orchestrates the sweep loop. Pure background — no caller
// blocks on it.
type CleanupRunner struct {
	Repo domain.CleanupRepo
	Cfg  CleanupConfig
	Log  *slog.Logger
}

// Run blocks until ctx is cancelled. Performs an initial sweep on entry so
// a freshly-restarted process doesn't wait an Interval to start trimming.
func (r *CleanupRunner) Run(ctx context.Context) {
	cfg := r.Cfg.withDefaults()
	if r.Log != nil {
		r.Log.Info("admin.cleanup: starting", slog.Duration("interval", cfg.Interval))
	}
	r.sweepAll(ctx, cfg)
	t := time.NewTicker(cfg.Interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.sweepAll(ctx, cfg)
		}
	}
}

func (r *CleanupRunner) sweepAll(ctx context.Context, cfg CleanupConfig) {
	sweeps := []struct {
		name string
		fn   func(context.Context) (int64, error)
	}{
		{"note_yjs_updates", func(c context.Context) (int64, error) {
			return r.Repo.PruneNoteYjsUpdates(c, cfg.YjsUpdatesRetention)
		}},
		{"whiteboard_yjs_updates", func(c context.Context) (int64, error) {
			return r.Repo.PruneWhiteboardYjsUpdates(c, cfg.YjsUpdatesRetention)
		}},
		{"copilot_messages", func(c context.Context) (int64, error) {
			return r.Repo.PruneCopilotMessages(c, cfg.CopilotMessagesRetent)
		}},
		{"pipeline_attempts", func(c context.Context) (int64, error) {
			return r.Repo.PrunePipelineAttempts(c, cfg.PipelineAttemptsRetent)
		}},
	}
	for _, s := range sweeps {
		sctx, cancel := context.WithTimeout(ctx, cfg.SweepTimeoutEach)
		n, err := s.fn(sctx)
		cancel()
		if err != nil {
			if r.Log != nil {
				r.Log.Warn("admin.cleanup: sweep failed",
					slog.String("table", s.name), slog.Any("err", err))
			}
			continue
		}
		if n > 0 && r.Log != nil {
			r.Log.Info("admin.cleanup: pruned",
				slog.String("table", s.name), slog.Int64("rows", n))
		}
	}
}
