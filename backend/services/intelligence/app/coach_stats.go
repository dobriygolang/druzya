// coach_stats.go — Phase 2 snapshot panel KPIs.
//
// 4 cards в Coach UI: streak (kata) / focus today min / last mock score /
// next mock in days. Все агрегации через existing readers — нет new infra.
package app

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// CoachStats — wire-shape для UI snapshot.
//
// Arena/Lobby final purge 2026-05-06: NextMockInDays / NextMockCompany /
// StreakDays dropped from both the proto and this struct. The "next mock"
// card collapses to "no upcoming interview" client-side; streak is no longer
// surfaced after kata stream removal.
type CoachStats struct {
	FocusTodayMin   int
	LastMockScore   int    // 0..100
	LastMockSection string // '' if no mocks
}

// GetCoachStats — UC.
type GetCoachStats struct {
	Focus domain.FocusReader
	Mocks domain.MockReader
	Now   func() time.Time
}

// Do aggregates 3 cards. Best-effort: каждый reader fail → soft default,
// мы не валим snapshot из-за одного reader.
func (uc *GetCoachStats) Do(ctx context.Context, userID uuid.UUID) (CoachStats, error) {
	var out CoachStats

	// Focus today (UTC day) — sum LastNDays(1).
	if days, err := uc.Focus.LastNDays(ctx, userID, 1); err == nil && len(days) > 0 {
		// FocusDay.Seconds — от reader; конверт в minutes.
		out.FocusTodayMin = days[0].Seconds / 60
	}

	// Last mock — top finished.
	if ms, err := uc.Mocks.LastNFinished(ctx, userID, 1); err == nil && len(ms) > 0 {
		// MockSessionSummary.Score is 0..10 (10x scale). Renormalize 0..100.
		out.LastMockScore = ms[0].Score * 10
		out.LastMockSection = ms[0].Section
	}

	_ = fmt.Sprintf // unused-import guard for fmt; remove if needed
	return out, nil
}
