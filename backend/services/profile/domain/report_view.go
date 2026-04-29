package domain

import "time"

// ReportView is the weekly report shape passed to ports.
//
// Lives in domain (not app) so infra adapters — notably the Redis-backed
// ReportCache — can reference it without crossing the layering arrow into
// app. The use case (app.GetReport) still owns *building* the view; domain
// only hosts the type.
type ReportView struct {
	WeekStart       time.Time
	WeekEnd         time.Time
	Metrics         Activity
	Heatmap         []int
	Strengths       []string
	Weaknesses      []ReportWeakness
	StressAnalysis  string
	Recommendations []Recommendation

	// Поля ниже — расширения для /report (WeeklyReportPage). Заполняются
	// агрегациями из дополнительных запросов; на старых клиентах безопасно
	// игнорируются (proto3 default values).
	ActionsCount   int
	StreakDays     int
	BestStreak     int
	PrevXPEarned   int
	StrongSections []SectionBreakdown
	WeakSections   []SectionBreakdown
	WeeklyXP       []WeekComparison

	// AIInsight — Phase B: 2-paragraph Russian narrative produced by the
	// OpenRouter insight client. Empty string when the LLM is disabled
	// (OPENROUTER_API_KEY missing) or upstream call failed; the frontend
	// hides the section in that case (anti-fallback policy).
	AIInsight string

	// FeaturedMetric — server-picked headline metric for the share card.
	// Values: "streak" | "xp" | "" (empty ⇒ client default).
	// Selection rules (see PickFeaturedMetric):
	//   - "streak" if StreakDays >= 7
	//   - else "xp"
	FeaturedMetric string
}

// ReportWeakness is a node-scoped weak spot.
type ReportWeakness struct {
	AtlasNodeKey string
	Reason       string
}

// Recommendation mirrors openapi's Recommendation schema.
type Recommendation struct {
	Title       string
	Description string
	ActionKind  string
	Params      map[string]any
}

// PickFeaturedMetric implements the rules described on ReportView.FeaturedMetric.
// Pure function — kept exported for direct unit testing without spinning the
// whole GetReport.Do pipeline.
func PickFeaturedMetric(streakDays int) string {
	if streakDays >= 7 {
		return "streak"
	}
	return "xp"
}
