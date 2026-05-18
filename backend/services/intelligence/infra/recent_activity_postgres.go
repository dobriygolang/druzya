// recent_activity_postgres.go — 24h cross-surface activity.
//
// Aggregates last 24h counters from:
//   - hone_focus_sessions   (count + sum duration_seconds)
//   - hone_tasks            (status='done' AND updated_at >= now() - 24h)
//   - mock_sessions         (count + last finished result)
//   - hone_notes            (created_at >= now() - 24h)
//   - hone_reading_sessions (duration_seconds sum)
//   - speaking_sessions     (count + avg score)
//   - hone_vocab_queue      (reviewed in last 24h — approximated)
//
// Single function, several queries in parallel. Each query is fault-isolated:
// a single broken sub-query returns zero for its slice without failing the
// whole snapshot.
package infra

import (
	"context"
	"sync"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RecentActivityReader implements domain.RecentActivityReader.
type RecentActivityReader struct{ pool *pgxpool.Pool }

// NewRecentActivityReader wraps a pool.
func NewRecentActivityReader(pool *pgxpool.Pool) *RecentActivityReader {
	return &RecentActivityReader{pool: pool}
}

// Compile-time guard.
var _ domain.RecentActivityReader = (*RecentActivityReader)(nil)

// Last24h returns the snapshot. Errors are swallowed per sub-query — the
// goal is best-effort cross-surface memory, never a 500 on the caller side.
func (r *RecentActivityReader) Last24h(ctx context.Context, userID uuid.UUID) (domain.RecentActivitySummary, error) {
	out := domain.RecentActivitySummary{}
	if r.pool == nil {
		return out, nil
	}
	uid := sharedpg.UUID(userID)

	var wg sync.WaitGroup

	// Focus sessions.
	wg.Add(1)
	go func() {
		defer wg.Done()
		var count int
		var seconds int64
		_ = r.pool.QueryRow(ctx, `
			SELECT COUNT(*),
			       COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))::bigint), 0)
			  FROM hone_focus_sessions
			 WHERE user_id = $1
			   AND started_at >= NOW() - INTERVAL '24 hours'
			   AND ended_at IS NOT NULL`,
			uid,
		).Scan(&count, &seconds)
		out.FocusSessionsCount = count
		out.FocusMinutesTotal = int(seconds / 60)
	}()

	// Tasks done. Uses hone_tasks.status='done' marker. Some installs may
	// not have this exact schema — query errors are silent.
	wg.Add(1)
	go func() {
		defer wg.Done()
		var count int
		_ = r.pool.QueryRow(ctx, `
			SELECT COUNT(*)
			  FROM hone_tasks
			 WHERE user_id = $1
			   AND status = 'done'
			   AND updated_at >= NOW() - INTERVAL '24 hours'`,
			uid,
		).Scan(&count)
		out.TasksDone = count
	}()

	// Mock attempts (finished only) + last result.
	wg.Add(1)
	go func() {
		defer wg.Done()
		var count int
		_ = r.pool.QueryRow(ctx, `
			SELECT COUNT(*)
			  FROM mock_sessions
			 WHERE user_id = $1
			   AND status = 'finished'
			   AND finished_at >= NOW() - INTERVAL '24 hours'`,
			uid,
		).Scan(&count)
		out.MockAttempts = count

		var score *int
		_ = r.pool.QueryRow(ctx, `
			SELECT (ai_report->>'score')::int
			  FROM mock_sessions
			 WHERE user_id = $1
			   AND status = 'finished'
			   AND finished_at >= NOW() - INTERVAL '24 hours'
			   AND ai_report ? 'score'
			 ORDER BY finished_at DESC
			 LIMIT 1`,
			uid,
		).Scan(&score)
		if score != nil {
			// mock score is 0..10; renormalise to 0..100 to match snapshot semantics.
			out.LastMockResult = (*score) * 10
		}
	}()

	// Notes created.
	wg.Add(1)
	go func() {
		defer wg.Done()
		var count int
		_ = r.pool.QueryRow(ctx, `
			SELECT COUNT(*)
			  FROM hone_notes
			 WHERE user_id = $1
			   AND created_at >= NOW() - INTERVAL '24 hours'`,
			uid,
		).Scan(&count)
		out.NotesCreated = count
	}()

	// Reading minutes.
	wg.Add(1)
	go func() {
		defer wg.Done()
		var seconds int64
		_ = r.pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(duration_seconds), 0)::bigint
			  FROM hone_reading_sessions
			 WHERE user_id = $1
			   AND started_at >= NOW() - INTERVAL '24 hours'`,
			uid,
		).Scan(&seconds)
		out.ReadingMinutes = int(seconds / 60)
	}()

	// Speaking attempts + avg score.
	wg.Add(1)
	go func() {
		defer wg.Done()
		var count int
		var avg float64
		_ = r.pool.QueryRow(ctx, `
			SELECT COUNT(*),
			       COALESCE(AVG(
			           (COALESCE(pronunciation_score, 0) + COALESCE(fluency_score, 0)) / 2.0
			       ), 0)
			  FROM speaking_sessions
			 WHERE user_id = $1
			   AND created_at >= NOW() - INTERVAL '24 hours'`,
			uid,
		).Scan(&count, &avg)
		out.SpeakingAttempts = count
		out.SpeakingAvgScore = avg
	}()

	// Vocab reviewed (count of rows whose next_review_at moved in last 24h).
	wg.Add(1)
	go func() {
		defer wg.Done()
		var count int
		_ = r.pool.QueryRow(ctx, `
			SELECT COUNT(*)
			  FROM hone_vocab_queue
			 WHERE user_id = $1
			   AND reviewed_count > 0
			   AND next_review_at >= NOW() - INTERVAL '12 hours'`,
			uid,
		).Scan(&count)
		out.VocabReviewed = count
	}()

	wg.Wait()
	return out, nil
}
