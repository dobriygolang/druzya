// english_activity_postgres.go — English activity reader.
//
// Aggregates 7-day window over:
//   - hone_reading_sessions   → distinct days
//   - hone_vocab_queue        → distinct days where reviewed_count changed
//                                (approximated via last reviewed_at)
//   - speaking_sessions       → count + avg score + last_at
//
// Vocab "reviewed-days" detection is approximate: hone_vocab_queue keeps
// next_review_at + reviewed_count but no per-event timestamp log. We use
// next_review_at as a proxy — when SRS algorithm bumps the queue, it
// updates next_review_at; we count distinct DATE(next_review_at - INTERVAL)
// approximation is fine for the producer's nudge logic. If precision
// matters later, a hone_vocab_review_events log can be added.
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

// EnglishActivityReader implements domain.EnglishActivityReader.
type EnglishActivityReader struct{ pool *pgxpool.Pool }

// NewEnglishActivityReader wraps a pool.
func NewEnglishActivityReader(pool *pgxpool.Pool) *EnglishActivityReader {
	return &EnglishActivityReader{pool: pool}
}

// Compile-time guard.
var _ domain.EnglishActivityReader = (*EnglishActivityReader)(nil)

// Summary7d returns the aggregate. Failures на отдельных под-запросах
// возвращаем zero value — лучше частичный сигнал чем 503.
func (r *EnglishActivityReader) Summary7d(ctx context.Context, userID uuid.UUID) (domain.EnglishActivitySummary, error) {
	out := domain.EnglishActivitySummary{}

	// Reading days: distinct DATE(started_at) за 7 дней.
	if r.pool != nil {
		err := r.pool.QueryRow(ctx, `
			SELECT COUNT(DISTINCT DATE(started_at))
			  FROM hone_reading_sessions
			 WHERE user_id = $1
			   AND started_at >= NOW() - INTERVAL '7 days'`,
			sharedpg.UUID(userID),
		).Scan(&out.ReadingDaysLast7)
		if err != nil {
			return out, fmt.Errorf("english_activity.reading: %w", err)
		}
	}

	// Vocab reviewed days (approx via next_review_at recency). При SRS
	// каждый review бампит next_review_at; считаем уникальные дни
	// где card "созрела" в последние 7 дней — это proxy для review activity.
	if r.pool != nil {
		err := r.pool.QueryRow(ctx, `
			SELECT COUNT(DISTINCT DATE(next_review_at - INTERVAL '1 day'))
			  FROM hone_vocab_queue
			 WHERE user_id = $1
			   AND reviewed_count > 0
			   AND next_review_at >= NOW() - INTERVAL '7 days'
			   AND next_review_at <= NOW() + INTERVAL '14 days'`,
			sharedpg.UUID(userID),
		).Scan(&out.VocabReviewedLast7)
		if err != nil {
			return out, fmt.Errorf("english_activity.vocab: %w", err)
		}
	}

	// Speaking aggregate. Single query: count + avg + last_at.
	if r.pool != nil {
		var last *time.Time
		err := r.pool.QueryRow(ctx, `
			SELECT
				COALESCE(COUNT(*), 0),
				COALESCE(AVG(
					(COALESCE(pronunciation_score, 0) + COALESCE(fluency_score, 0)) / 2.0
				), 0.0),
				MAX(created_at)
			  FROM speaking_sessions
			 WHERE user_id = $1
			   AND created_at >= NOW() - INTERVAL '7 days'`,
			sharedpg.UUID(userID),
		).Scan(&out.SpeakingAttempts7d, &out.SpeakingAvgScore7d, &last)
		if err != nil {
			return out, fmt.Errorf("english_activity.speaking: %w", err)
		}
		if last != nil {
			out.LastSpeakingAt = *last
		}
	}

	return out, nil
}
