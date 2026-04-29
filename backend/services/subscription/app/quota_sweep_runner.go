// quota_sweep_runner.go — periodic auto-downgrade for free-tier shared
// rooms and notes. Three independent loops (whiteboards / editor rooms /
// notes) so a stuck statement on one table doesn't block the others.
//
// Defaults match the original cmd/-side behaviour: first run 30s after
// process start (warmup), then hourly. The notes loop uses 45s warmup
// (kept slightly later so it doesn't pile on top of the room sweeps).
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/subscription/domain"
)

// QuotaSweepConfig — tunables. Zero values use sane defaults.
type QuotaSweepConfig struct {
	WhiteboardWarmup time.Duration // default 30s
	EditorWarmup     time.Duration // default 30s
	NotesWarmup      time.Duration // default 45s
	Interval         time.Duration // default 1h
	FreeNotesLimit   int           // default 10 — see domain.PolicyDefaults
}

func (c QuotaSweepConfig) withDefaults() QuotaSweepConfig {
	if c.WhiteboardWarmup == 0 {
		c.WhiteboardWarmup = 30 * time.Second
	}
	if c.EditorWarmup == 0 {
		c.EditorWarmup = 30 * time.Second
	}
	if c.NotesWarmup == 0 {
		c.NotesWarmup = 45 * time.Second
	}
	if c.Interval == 0 {
		c.Interval = time.Hour
	}
	if c.FreeNotesLimit == 0 {
		c.FreeNotesLimit = 10
	}
	return c
}

// QuotaSweepRunner — three Run* methods for the three independent loops.
// Caller spawns each in its own goroutine so they tick independently.
type QuotaSweepRunner struct {
	Repo domain.QuotaSweepRepo
	Cfg  QuotaSweepConfig
	Log  *slog.Logger
}

func (r *QuotaSweepRunner) RunWhiteboards(ctx context.Context) {
	cfg := r.Cfg.withDefaults()
	r.loop(ctx, cfg.WhiteboardWarmup, cfg.Interval, r.sweepWhiteboards)
}

func (r *QuotaSweepRunner) RunEditorRooms(ctx context.Context) {
	cfg := r.Cfg.withDefaults()
	r.loop(ctx, cfg.EditorWarmup, cfg.Interval, r.sweepEditorRooms)
}

func (r *QuotaSweepRunner) RunNotesArchive(ctx context.Context) {
	cfg := r.Cfg.withDefaults()
	r.loop(ctx, cfg.NotesWarmup, cfg.Interval, func(c context.Context) {
		r.sweepNotes(c, cfg.FreeNotesLimit)
	})
}

func (r *QuotaSweepRunner) loop(ctx context.Context, warmup, interval time.Duration, body func(context.Context)) {
	first := time.NewTimer(warmup)
	defer first.Stop()
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-first.C:
			body(ctx)
		case <-tick.C:
			body(ctx)
		}
	}
}

func (r *QuotaSweepRunner) sweepWhiteboards(ctx context.Context) {
	if n, err := r.Repo.DowngradeExpiredWhiteboards(ctx); err != nil {
		r.warn(ctx, "free_tier_downgrade.whiteboard", err)
	} else if n > 0 {
		r.info(ctx, "free_tier_downgrade.whiteboard", "demoted", n)
	}
	if n, err := r.Repo.DowngradeOverflowWhiteboards(ctx); err != nil {
		r.warn(ctx, "free_tier_overflow_downgrade.whiteboard", err)
	} else if n > 0 {
		r.info(ctx, "free_tier_overflow_downgrade.whiteboard", "demoted", n)
	}
}

func (r *QuotaSweepRunner) sweepEditorRooms(ctx context.Context) {
	if n, err := r.Repo.DowngradeExpiredEditorRooms(ctx); err != nil {
		r.warn(ctx, "free_tier_downgrade.editor", err)
	} else if n > 0 {
		r.info(ctx, "free_tier_downgrade.editor", "demoted", n)
	}
	if n, err := r.Repo.DowngradeOverflowEditorRooms(ctx); err != nil {
		r.warn(ctx, "free_tier_overflow_downgrade.editor", err)
	} else if n > 0 {
		r.info(ctx, "free_tier_overflow_downgrade.editor", "demoted", n)
	}
}

func (r *QuotaSweepRunner) sweepNotes(ctx context.Context, limit int) {
	if n, err := r.Repo.ArchiveOverflowNotes(ctx, limit); err != nil {
		r.warn(ctx, "free_tier_overflow_archive.notes", err)
	} else if n > 0 {
		r.info(ctx, "free_tier_overflow_archive.notes", "archived", n)
	}
}

func (r *QuotaSweepRunner) warn(ctx context.Context, msg string, err error) {
	if r.Log == nil {
		return
	}
	r.Log.WarnContext(ctx, msg, "err", err)
}

func (r *QuotaSweepRunner) info(ctx context.Context, msg, key string, n int64) {
	if r.Log == nil {
		return
	}
	r.Log.InfoContext(ctx, msg, key, n)
}
