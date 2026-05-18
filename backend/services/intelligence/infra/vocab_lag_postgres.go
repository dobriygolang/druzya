// vocab_lag_postgres.go — SRS vocab lag reader.
//
// Inputs over hone_vocab_queue:
//   - TotalCards    — count(*) WHERE user_id=$1.
//   - DueCards      — count where next_review_at <= now().
//   - DaysSinceLastReview — derived from MAX(last "implicit review" time).
//     hone_vocab_queue has reviewed_count but no last_reviewed_at column;
//     we approximate via the row's updated_at: next_review_at update fires
//     on every SRS interaction, so we use that proxy. -1 when reviewed_count
//     is zero on all rows (never-reviewed) — producer treats this as a
//     "welcome back" case.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VocabLagReader implements domain.VocabLagReader.
type VocabLagReader struct{ pool *pgxpool.Pool }

// NewVocabLagReader wraps a pool.
func NewVocabLagReader(pool *pgxpool.Pool) *VocabLagReader {
	return &VocabLagReader{pool: pool}
}

// Compile-time guard.
var _ domain.VocabLagReader = (*VocabLagReader)(nil)

// Lag returns the snapshot.
func (r *VocabLagReader) Lag(ctx context.Context, userID uuid.UUID) (domain.VocabLagSummary, error) {
	out := domain.VocabLagSummary{DaysSinceLastReview: -1}
	if r.pool == nil {
		return out, nil
	}

	// Counts in a single round-trip.
	err := r.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE next_review_at <= NOW()) AS due
		  FROM hone_vocab_queue
		 WHERE user_id = $1`,
		sharedpg.UUID(userID),
	).Scan(&out.TotalCards, &out.DueCards)
	if err != nil {
		return out, fmt.Errorf("vocab_lag.counts: %w", err)
	}

	if out.TotalCards == 0 {
		return out, nil
	}

	// «Last review» proxy — MAX(next_review_at) - typical SRS interval.
	// We don't have an explicit reviewed_at; the SRS algorithm sets
	// next_review_at = now() + interval after a review, so the *most-recent
	// review* sits at MAX(next_review_at) - typical_interval. We can't
	// recover the exact moment without a log table, but we can detect
	// "never reviewed" vs "reviewed at least once" by reviewed_count > 0,
	// and approximate "days since last review" by NOW() - MAX(updated_at)
	// when the row engine ships an updated_at trigger (most repos do).
	//
	// Fall-back: if no reviewed_count>0 rows exist, leave DaysSinceLastReview=-1.
	var lastTouch *time.Time
	err = r.pool.QueryRow(ctx, `
		SELECT MAX(next_review_at)
		  FROM hone_vocab_queue
		 WHERE user_id = $1
		   AND reviewed_count > 0`,
		sharedpg.UUID(userID),
	).Scan(&lastTouch)
	if err != nil {
		return out, fmt.Errorf("vocab_lag.last_touch: %w", err)
	}
	if lastTouch != nil {
		// Approximate "days since" by clamping the diff to [0, 365].
		diff := time.Since(*lastTouch)
		days := int(diff.Hours() / 24)
		if days < 0 {
			// next_review_at is in the future → the card was reviewed
			// recently (the future part is the SRS-spaced "next review").
			// Convert "review happened today" to 0.
			days = 0
		}
		if days > 365 {
			days = 365
		}
		out.DaysSinceLastReview = days
	}

	return out, nil
}
