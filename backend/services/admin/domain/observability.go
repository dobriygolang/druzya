package domain

import "time"

// Observability domain types — shapes returned by infra.Observability,
// consumed by chi-direct admin handlers (Wave 3.5.x of
// docs/feature/plan.md). Read-only by design — admin views over data
// owned by other bounded contexts (user_persona_tracks, mock_sessions).

// TrackDistributionRow — one row per track_kind enum value with
// per-track adoption stats. Includes tracks with zero users (LEFT
// JOIN unnest(enum_range)) so the dashboard can flag «not adopted».
type TrackDistributionRow struct {
	Track        string
	Total        int
	PrimaryCount int
	Active30d    int
}

// EnglishHRStats — admin-scoped aggregation across ALL English HR
// mock-sessions in the trailing window. Mirrors the per-user
// EnglishHRTrend but unfiltered by user, plus an error-rate signal
// that detects ai_report=NULL (worker silently failed to grade).
type EnglishHRStats struct {
	TotalSessions int
	WithReport    int
	AvgScore      int
	ErrorRate     int // (total - with_report) / total · 100
	Recent        []EnglishHRRecent
}

// EnglishHRRecent — one row of the recent-sessions list. UserHash is
// the first 8 chars of the user UUID — enough for support to
// disambiguate a complaint without leaking the full identifier.
type EnglishHRRecent struct {
	SessionID  string
	UserHash   string
	FinishedAt time.Time
	Score      int
	Errored    bool // ai_report IS NULL
}

// MockBlockMetrics — engineering mock-sessions split by ai_assist
// flag. The strict_pct number is the headline KPI: it should be
// >50% on a healthy product (mock-block protocol working as
// intended); a sudden drop signals either Cue mis-routed or a UI
// bug forcing ai_assist=true by default.
type MockBlockMetrics struct {
	TotalSessions    int
	AIAssistSessions int
	StrictSessions   int
	StrictPct        int
}

// ObservabilityRepo is the chi-direct admin handler's persistence
// dependency. Each method is independently fail-soft: errors return
// zero-value structs alongside the wrapped error so the handler can
// 500 cleanly without a partial JSON.
//
// Used by ports.ObservabilityHandler in cmd/monolith wiring.
//
// (We don't define a context.Context method signature here — the
// repo's chosen impl in infra/observability_repo.go uses standard
// pgx + ctx; this interface is only for test substitution.)
type ObservabilityRepoMethods interface {
	// Implementations:
	//   * infra.Observability — production
	//   * test fakes — wherever needed
	//
	// (Method signatures kept on the concrete struct in infra/ so
	// adding metrics doesn't force an interface refactor.)
}
