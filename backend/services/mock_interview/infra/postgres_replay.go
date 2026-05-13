// postgres_replay.go — repo-methods для domain.ReplayRepo. Methods
// hang off PipelineAttempts (already a struct in postgres_pipelines.go)
// — they read / write three columns added in migration 00125
// (ideal_answer_md / diff_annotations / replay_generated_at) on
// pipeline_attempts.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// GetReplay loads cached ideal_answer_md + diff_annotations + stamp.
// Returns domain.ErrReplayNotReady when replay_generated_at IS NULL.
func (r *PipelineAttempts) GetReplay(ctx context.Context, attemptID uuid.UUID) (domain.AttemptReplay, error) {
	var (
		ideal      pgtype.Text
		annJSON    []byte
		generated  pgtype.Timestamptz
	)
	err := r.pool.QueryRow(ctx, `
		SELECT ideal_answer_md, diff_annotations, replay_generated_at
		FROM pipeline_attempts
		WHERE id = $1`,
		sharedpg.UUID(attemptID),
	).Scan(&ideal, &annJSON, &generated)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AttemptReplay{}, domain.ErrNotFound
		}
		return domain.AttemptReplay{}, fmt.Errorf("mock_interview.GetReplay: %w", err)
	}
	if !generated.Valid {
		return domain.AttemptReplay{}, domain.ErrReplayNotReady
	}
	out := domain.AttemptReplay{
		AttemptID:   attemptID,
		GeneratedAt: generated.Time,
	}
	if ideal.Valid {
		out.IdealAnswerMD = ideal.String
	}
	if len(annJSON) > 0 && string(annJSON) != "null" {
		var anns []domain.ReplayAnnotation
		if uerr := json.Unmarshal(annJSON, &anns); uerr != nil {
			// Treat broken jsonb as "no annotations" rather than failing the
			// whole read — surfaces the ideal_answer body to the user even
			// if the diff payload got corrupted (defensive degradation).
			return out, nil //nolint:nilerr // we intentionally return partial
		}
		out.Annotations = anns
	}
	return out, nil
}

// SetReplay overwrites the cached pair. now is supplied by the caller
// (use case layer) so tests can control time without poking through
// time.Now() in the SQL.
func (r *PipelineAttempts) SetReplay(ctx context.Context, attemptID uuid.UUID,
	ideal string, annotations []domain.ReplayAnnotation, now time.Time) error {
	// nil-safe jsonb — pgx wants []byte; empty array is the canonical
	// "no annotations" payload (NULL would also work but `[]` reads
	// nicer in `psql` for ops).
	if annotations == nil {
		annotations = []domain.ReplayAnnotation{}
	}
	annJSON, err := json.Marshal(annotations)
	if err != nil {
		return fmt.Errorf("mock_interview.SetReplay marshal: %w", err)
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE pipeline_attempts SET
			ideal_answer_md      = NULLIF($2, ''),
			diff_annotations     = $3::jsonb,
			replay_generated_at  = $4
		WHERE id = $1`,
		sharedpg.UUID(attemptID),
		ideal,
		annJSON,
		pgtype.Timestamptz{Time: now.UTC(), Valid: true},
	)
	if err != nil {
		return fmt.Errorf("mock_interview.SetReplay: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Compile-time assertion — PipelineAttempts satisfies the narrow
// ReplayRepo interface in addition to its main PipelineAttemptRepo
// role.
var _ domain.ReplayRepo = (*PipelineAttempts)(nil)
