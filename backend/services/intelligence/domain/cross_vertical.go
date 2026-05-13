// cross_vertical.go — Wave 15 domain types for the cross-vertical
// insights v2 use case + recent-activity context. Kept in a separate file
// so repo.go (already large) stays focussed on the daily-brief contract.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ── English / Speaking / Vocab readers ──────────────────────────────────

// EnglishActivitySummary — projection 7-day English engagement used by
// the cross_vertical_insights producer chain.
//
// Counts are distinct YYYY-MM-DD days within the 7-day window; this
// smooths over users who do 5 short sessions in one evening.
type EnglishActivitySummary struct {
	ReadingDaysLast7   int
	VocabReviewedLast7 int
	SpeakingAttempts7d int
	// 0..100 avg of pronunciation+fluency; 0 when no attempts.
	SpeakingAvgScore7d float64
	// LastSpeakingAt zero when no attempts ever.
	LastSpeakingAt time.Time
}

// EnglishActivityReader — narrow reader implemented in
// intelligence/infra/english_activity_postgres.go.
type EnglishActivityReader interface {
	Summary7d(ctx context.Context, userID uuid.UUID) (EnglishActivitySummary, error)
}

// VocabLagSummary — projection of hone_vocab_queue lag.
//
// DaysSinceLastReview = -1 means "never reviewed at all" (queue has rows
// but no reviewed_count > 0). Implementation in intelligence/infra.
type VocabLagSummary struct {
	TotalCards          int
	DueCards            int
	DaysSinceLastReview int
}

// VocabLagReader — narrow reader.
type VocabLagReader interface {
	Lag(ctx context.Context, userID uuid.UUID) (VocabLagSummary, error)
}

// ── Recent-activity (24h) summary used by GetUserContext + brief ────────

// RecentActivitySummary — 24-hour snapshot. Counts (no contents) so the
// /coach prompt + Cue suggestion get «вчера ты сделал X», без leaks
// чувствительного содержимого.
type RecentActivitySummary struct {
	// FocusSessionsCount — # completed hone_focus_sessions in last 24h.
	FocusSessionsCount int
	// FocusMinutesTotal — sum of duration in last 24h, minutes.
	FocusMinutesTotal int
	// TasksDone — # hone_tasks completed (status='done') in last 24h.
	TasksDone int
	// MockAttempts — # mock_sessions finished in last 24h.
	MockAttempts int
	// LastMockResult — score 0..100 of the most recent finished mock
	// in the 24h window; 0 if none.
	LastMockResult int
	// NotesCreated — # hone_notes inserted in last 24h (count only).
	NotesCreated int
	// ReadingMinutes — sum of hone_reading_sessions duration in last 24h.
	ReadingMinutes int
	// SpeakingAttempts — # speaking_sessions in last 24h.
	SpeakingAttempts int
	// SpeakingAvgScore — avg ((pronunciation+fluency)/2) of those, 0..100.
	SpeakingAvgScore float64
	// VocabReviewed — count of hone_vocab_queue rows reviewed in 24h.
	VocabReviewed int
}

// RecentActivityReader — narrow reader for the 24h snapshot.
// Implementation in intelligence/infra/recent_activity_postgres.go.
type RecentActivityReader interface {
	Last24h(ctx context.Context, userID uuid.UUID) (RecentActivitySummary, error)
}
