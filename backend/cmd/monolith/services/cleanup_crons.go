// cleanup_crons.go — periodic retention pass for tables that grow
// unbounded if left alone. Runs once per hour as a single Background
// goroutine; each pass executes the individual sweeps in sequence and
// logs row counts. Failures in one sweep never abort the others.
//
// What lives here vs elsewhere:
//   - sync_replication.go owns the sync_tombstones GC (different cadence
//     + different retention policy, kept per-domain).
//   - storage.go owns per-user quota recompute (also different cadence).
//   - This file is the sweep for tables that: (a) have no business
//     logic owning their lifecycle, and (b) grow with active use rather
//     than user count.
//
// Tuning knobs are local consts. We don't promote them to config.Config
// yet — it's a single-binary monolith, code-deploys are cheap, and
// having the policy literal in source makes the intent grep-able.

package services

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Retention windows.
const (
	yjsUpdatesRetention     = 90 * 24 * time.Hour      // 90 days
	copilotMessagesRetent   = 365 * 24 * time.Hour     // 1 year
	pipelineAttemptsRetent  = 2 * 365 * 24 * time.Hour // 2 years
	cleanupCronInterval     = 1 * time.Hour
	cleanupSweepTimeoutEach = 30 * time.Second
)

// NewCleanupCrons wires the sweep module. Pure background — no REST/
// Connect surface. Single ticker loops every cleanupCronInterval and
// runs each sweep in sequence under its own bounded context.
func NewCleanupCrons(d Deps) *Module {
	return &Module{
		Background: []func(ctx context.Context){
			func(ctx context.Context) {
				runCleanupCron(ctx, d.Pool, d.Log)
			},
		},
	}
}

func runCleanupCron(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	if log != nil {
		log.Info("cleanup.cron: starting", slog.Duration("interval", cleanupCronInterval))
	}
	// Run once on boot so a freshly-restarted process doesn't wait an
	// hour to start trimming. Subsequent runs are on the ticker.
	sweepAll(ctx, pool, log)
	t := time.NewTicker(cleanupCronInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sweepAll(ctx, pool, log)
		}
	}
}

func sweepAll(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	sweeps := []struct {
		name string
		fn   func(context.Context, *pgxpool.Pool) (int64, error)
	}{
		{"note_yjs_updates", sweepNoteYjsUpdates},
		{"whiteboard_yjs_updates", sweepWhiteboardYjsUpdates},
		{"copilot_messages", sweepCopilotMessages},
		{"pipeline_attempts", sweepPipelineAttempts},
	}
	for _, s := range sweeps {
		sctx, cancel := context.WithTimeout(ctx, cleanupSweepTimeoutEach)
		n, err := s.fn(sctx, pool)
		cancel()
		if err != nil {
			if log != nil {
				log.Warn("cleanup.cron: sweep failed",
					slog.String("table", s.name), slog.Any("err", err))
			}
			continue
		}
		if n > 0 && log != nil {
			log.Info("cleanup.cron: pruned",
				slog.String("table", s.name), slog.Int64("rows", n))
		}
	}
}

// sweepNoteYjsUpdates deletes Yjs updates older than 90 days BUT only
// when a newer update exists for the same note. Keeps the latest row
// per note as a recovery anchor for the client merge path. See
// migration 00033 header for the lifecycle discussion.
func sweepNoteYjsUpdates(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	cmd, err := pool.Exec(ctx, `
		DELETE FROM note_yjs_updates u1
		 WHERE u1.created_at < now() - $1::interval
		   AND EXISTS (
		       SELECT 1 FROM note_yjs_updates u2
		        WHERE u2.note_id = u1.note_id AND u2.seq > u1.seq
		   )`,
		fmt.Sprintf("%d hours", int(yjsUpdatesRetention.Hours())),
	)
	if err != nil {
		return 0, fmt.Errorf("note_yjs_updates: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// sweepWhiteboardYjsUpdates — same shape, different table.
func sweepWhiteboardYjsUpdates(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	cmd, err := pool.Exec(ctx, `
		DELETE FROM whiteboard_yjs_updates u1
		 WHERE u1.created_at < now() - $1::interval
		   AND EXISTS (
		       SELECT 1 FROM whiteboard_yjs_updates u2
		        WHERE u2.whiteboard_id = u1.whiteboard_id AND u2.seq > u1.seq
		   )`,
		fmt.Sprintf("%d hours", int(yjsUpdatesRetention.Hours())),
	)
	if err != nil {
		return 0, fmt.Errorf("whiteboard_yjs_updates: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// sweepCopilotMessages drops chat history older than 1 year. The
// session row is kept (analytics + report) — only the message body
// stream is purged.
func sweepCopilotMessages(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	cmd, err := pool.Exec(ctx, `
		DELETE FROM copilot_messages
		 WHERE created_at < now() - $1::interval`,
		fmt.Sprintf("%d hours", int(copilotMessagesRetent.Hours())),
	)
	if err != nil {
		return 0, fmt.Errorf("copilot_messages: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// sweepPipelineAttempts drops attempts whose parent pipeline is older
// than 2 years AND finished. We cascade through pipeline.started_at to
// avoid scanning the attempts table directly.
func sweepPipelineAttempts(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	cmd, err := pool.Exec(ctx, `
		DELETE FROM pipeline_attempts
		 WHERE pipeline_stage_id IN (
		     SELECT ps.id FROM pipeline_stages ps
		       JOIN mock_pipelines p ON p.id = ps.pipeline_id
		      WHERE p.started_at < now() - $1::interval
		        AND p.verdict IN ('pass','fail','cancelled')
		 )`,
		fmt.Sprintf("%d hours", int(pipelineAttemptsRetent.Hours())),
	)
	if err != nil {
		return 0, fmt.Errorf("pipeline_attempts: %w", err)
	}
	return cmd.RowsAffected(), nil
}
