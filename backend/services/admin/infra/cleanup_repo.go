// cleanup_repo.go — implements domain.CleanupRepo against pgx.
//
// The deletion shape and retention policy lived in cmd/monolith for a long
// time; it's been moved here so cmd/ stays a pure facade and so other call
// sites (admin REST "/cleanup/run-now" if we ever add one) can reuse it.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CleanupRepo struct {
	Pool *pgxpool.Pool
}

func NewCleanupRepo(pool *pgxpool.Pool) *CleanupRepo {
	return &CleanupRepo{Pool: pool}
}

func intervalArg(d time.Duration) string {
	return fmt.Sprintf("%d hours", int(d.Hours()))
}

// PruneNoteYjsUpdates deletes Yjs updates older than `retention` BUT only
// when a newer update exists for the same note — keeps the latest row per
// note as a recovery anchor for the client merge path.
func (r *CleanupRepo) PruneNoteYjsUpdates(ctx context.Context, retention time.Duration) (int64, error) {
	cmd, err := r.Pool.Exec(ctx, `
        DELETE FROM note_yjs_updates u1
         WHERE u1.created_at < now() - $1::interval
           AND EXISTS (
               SELECT 1 FROM note_yjs_updates u2
                WHERE u2.note_id = u1.note_id AND u2.seq > u1.seq
           )`, intervalArg(retention))
	if err != nil {
		return 0, fmt.Errorf("admin.CleanupRepo.PruneNoteYjsUpdates: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// PruneWhiteboardYjsUpdates — same shape, different table.
func (r *CleanupRepo) PruneWhiteboardYjsUpdates(ctx context.Context, retention time.Duration) (int64, error) {
	cmd, err := r.Pool.Exec(ctx, `
        DELETE FROM whiteboard_yjs_updates u1
         WHERE u1.created_at < now() - $1::interval
           AND EXISTS (
               SELECT 1 FROM whiteboard_yjs_updates u2
                WHERE u2.whiteboard_id = u1.whiteboard_id AND u2.seq > u1.seq
           )`, intervalArg(retention))
	if err != nil {
		return 0, fmt.Errorf("admin.CleanupRepo.PruneWhiteboardYjsUpdates: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// PruneCopilotMessages drops chat history older than retention. The session
// row is kept (analytics + report) — only the message body stream is purged.
func (r *CleanupRepo) PruneCopilotMessages(ctx context.Context, retention time.Duration) (int64, error) {
	cmd, err := r.Pool.Exec(ctx, `
        DELETE FROM copilot_messages
         WHERE created_at < now() - $1::interval`, intervalArg(retention))
	if err != nil {
		return 0, fmt.Errorf("admin.CleanupRepo.PruneCopilotMessages: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// PrunePipelineAttempts drops attempts whose parent pipeline is older than
// retention AND finished. Cascades through pipeline.started_at to avoid
// scanning the attempts table directly.
func (r *CleanupRepo) PrunePipelineAttempts(ctx context.Context, retention time.Duration) (int64, error) {
	cmd, err := r.Pool.Exec(ctx, `
        DELETE FROM pipeline_attempts
         WHERE pipeline_stage_id IN (
             SELECT ps.id FROM pipeline_stages ps
               JOIN mock_pipelines p ON p.id = ps.pipeline_id
              WHERE p.started_at < now() - $1::interval
                AND p.verdict IN ('pass','fail','cancelled')
         )`, intervalArg(retention))
	if err != nil {
		return 0, fmt.Errorf("admin.CleanupRepo.PrunePipelineAttempts: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// Compile-time guard.
var _ domain.CleanupRepo = (*CleanupRepo)(nil)
