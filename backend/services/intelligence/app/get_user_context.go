//go:generate mockgen -package app -destination get_user_context_mock_test.go -source get_user_context.go AtlasReader
// Package app — cross-product context bundle for Cue copilot.
//
// The unique moat vs Cluely / Final Round AI: when the user fires a
// suggestion, the Cue backend already knows their
// learning identity — primary goal, recent Coach memory, what they
// touched this week, where their skill radar is weak, which atlas
// resources match. Suggestion comes back personalised, not generic.
//
// This UC is the SINGLE source of truth for that bundle. Both the
// REST /api/v1/copilot/suggestion handler AND the Connect-RPC
// Analyze/Chat streams call it. Cache lives at the caller side (Redis
// 60s TTL) — the UC itself is stateless, no internal memoisation,
// so tests don't need to wait out a TTL.
//
// Design notes:
//   - Token budget for the FORMATTED prompt block is ~500 tokens.
//     This UC returns the RAW bundle; formatting & truncation is the
//     caller's job (different personas use different slices).
//   - All sub-readers are optional. Missing readers return zero values
//     gracefully — never blocks suggestion path. Coach can fall back
//     to "no context" if intelligence is briefly degraded.
//   - We deliberately project a MINIMAL coach episode (kind, summary,
//     occurred_at) — payload bodies are NOT exposed. Cue prompt-tail
//     is untrusted context; leaking full reflection bodies would be
//     a privacy + injection surface.
package app

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// UserContextBundle is the wire-shape of the C3 bundle. Mirrors the
// druz9.v1.UserContext proto but stays in domain-friendly Go types
// (no proto imports in app/).
type UserContextBundle struct {
	// ActiveGoal — nil when user has no active primary goal.
	ActiveGoal *domain.PrimaryGoal
	// RecentMemory — last N coach episodes (newest first).
	RecentMemory []CoachMemoryEntry
	// Activity — 7d / 30d activity_log summary.
	Activity ActivitySummaryView
	// Radar — skill-radar snapshot.
	Radar SkillRadarView
	// RelevantResources — top-K atlas hits (empty until atlas hook wired).
	RelevantResources []AtlasResourceRef
	// RecentActivity24h — Wave 15 cross-surface 24h snapshot (counts only).
	// Empty struct когда RecentActivity reader не wired or query failed.
	RecentActivity24h domain.RecentActivitySummary
}

// CoachMemoryEntry — single projection for suggestion context.
type CoachMemoryEntry struct {
	Kind       string
	Summary    string
	OccurredAt time.Time
	HoursAgo   int
}

// ActivitySummaryView — rolled-up resource_log counts.
type ActivitySummaryView struct {
	Last7dCount  int
	Last30dCount int
	TopKinds     []string
}

// SkillRadarView — compact radar snapshot.
type SkillRadarView struct {
	Rubric        string
	Axes          []string
	AxisScores    []float64
	WeakestAxis   string
	StrongestAxis string
}

// AtlasResourceRef — placeholder for future atlas retrieval.
type AtlasResourceRef struct {
	ID    string
	Title string
	URL   string
	Kind  string
}

// IsEmpty reports whether the bundle has zero usable signals. Callers
// can skip prompt-injection entirely when this is true (saves tokens).
func (b UserContextBundle) IsEmpty() bool {
	if b.ActiveGoal != nil {
		return false
	}
	if len(b.RecentMemory) > 0 {
		return false
	}
	if b.Activity.Last7dCount > 0 || b.Activity.Last30dCount > 0 {
		return false
	}
	if len(b.Radar.Axes) > 0 {
		return false
	}
	if len(b.RelevantResources) > 0 {
		return false
	}
	return true
}

// GetUserContext aggregates cross-product signals into a compact bundle
// the Cue copilot injects into its suggestion prompt.
//
// Defaults:
//   - MemoryLimit: 12 episodes (covers ~2 weeks of typical activity).
//   - MemoryWindowDays: 14.
//   - ActivityWindow30d: 30.
//   - SkillRadarRubric: "dev_senior" (broadest senior-dev coverage).
//
// All sub-readers are nil-safe. Each is invoked in its own goroutine
// would be cleaner but the UC stays sequential for now — the readers
// hit different tables so there's no contention, and overall latency
// budget (~300ms p95) is dominated by the LLM call that follows.
type GetUserContext struct {
	Goals       domain.PrimaryGoalRepo
	Episodes    domain.EpisodeRepo
	ResourceEng domain.ResourceEngagementReader
	Mocks       domain.MockReader
	// AtlasReader — atlas-relevant resource retrieval. nil-safe; when
	// nil, RelevantResources is always empty in the bundle. Wired in
	// cmd/monolith/services/intelligence/atlas_reader_adapter.go.
	AtlasReader AtlasReader
	// Wave 15: RecentActivity — 24h cross-surface counters. nil-safe.
	RecentActivity domain.RecentActivityReader

	// MemoryLimit defaults to 12 when zero.
	MemoryLimit int
	// MemoryWindowDays defaults to 14 when zero.
	MemoryWindowDays int

	Now func() time.Time
}

// ActivityKind — narrow projection of the user's recent activity
// surfaces (mock stage_kind, resource log kind). The atlas reader uses
// these to boost matching nodes (e.g. recent algo activity → boost
// algo_* nodes).
type ActivityKind string

// AtlasReader — narrow port for atlas retrieval, scoped by user signal.
//
// Implementation strategy (adapter side):
//   - Match `goalText` keywords against atlas_nodes.title / description
//     (ILIKE fast-path; vector embedding upgrade later).
//   - Boost nodes whose section/cluster overlaps `recentActivity`.
//   - De-prioritise nodes the user already completed (skill_nodes.progress=100).
//   - Cap result count at limit.
type AtlasReader interface {
	TopRelevantNodes(ctx context.Context, userID uuid.UUID, goalText string, recentActivity []ActivityKind, limit int) ([]AtlasResourceRef, error)
}

// GetUserContextInput is the validated input. UserID is mandatory.
type GetUserContextInput struct {
	UserID uuid.UUID
}

// Do returns the bundle. Errors are LOG-AND-ZERO at the sub-reader
// boundary — a partial bundle is more useful than a failed call (a
// broken Activity reader shouldn't blank out the goal + memory).
//
// The only hard error condition: zero UserID.
func (uc *GetUserContext) Do(ctx context.Context, in GetUserContextInput) (UserContextBundle, error) {
	if in.UserID == uuid.Nil {
		return UserContextBundle{}, fmt.Errorf("intelligence.GetUserContext: %w: zero user_id", domain.ErrInvalidInput)
	}
	now := uc.now()

	out := UserContextBundle{}

	// ── 1. Active primary goal ──
	if uc.Goals != nil {
		if g, err := uc.Goals.GetActive(ctx, in.UserID); err == nil {
			out.ActiveGoal = &g
		}
		// Non-NotFound is a real error — but we still return a useful
		// partial bundle. Caller logs through its own path; we just
		// degrade silently.
	}

	// ── 2. Recent coach memory (last N episodes across all kinds) ──
	if uc.Episodes != nil {
		limit := uc.MemoryLimit
		if limit <= 0 {
			limit = 12
		}
		windowDays := uc.MemoryWindowDays
		if windowDays <= 0 {
			windowDays = 14
		}

		// LatestByKinds with empty kinds = "all kinds" via repo contract.
		eps, err := uc.Episodes.LatestByKinds(ctx, in.UserID, nil, limit)
		if err == nil {
			out.RecentMemory = make([]CoachMemoryEntry, 0, len(eps))
			for _, e := range eps {
				// Skip episodes older than the window — repo gives us
				// newest-first so we can break early.
				ago := now.Sub(e.OccurredAt)
				if ago > time.Duration(windowDays)*24*time.Hour {
					break
				}
				out.RecentMemory = append(out.RecentMemory, CoachMemoryEntry{
					Kind:       string(e.Kind),
					Summary:    truncateLine(e.Summary, 200),
					OccurredAt: e.OccurredAt,
					HoursAgo:   int(ago.Hours()),
				})
			}
		}
	}

	// ── 3. Activity summary (7d / 30d via ResourceEngagement) ──
	if uc.ResourceEng != nil {
		// 7-day for top kinds + count.
		if eng7, err := uc.ResourceEng.EngagementWindow(ctx, in.UserID, 7, 20); err == nil {
			out.Activity.Last7dCount = len(eng7.FinishedRecent) + eng7.UnfinishedCount + len(eng7.MarkedUnhelpful)
			out.Activity.TopKinds = topKindsFromTouches(eng7)
		}
		// 30-day for the broader count.
		if eng30, err := uc.ResourceEng.EngagementWindow(ctx, in.UserID, 30, 50); err == nil {
			out.Activity.Last30dCount = len(eng30.FinishedRecent) + eng30.UnfinishedCount + len(eng30.MarkedUnhelpful)
		}
	}

	// ── 4. Skill radar snapshot (default rubric: dev_senior) ──
	if uc.Mocks != nil {
		radar := &GetSkillRadar{Mocks: uc.Mocks}
		snap, err := radar.Do(ctx, GetSkillRadarInput{UserID: in.UserID, Rubric: "dev_senior"})
		if err == nil {
			out.Radar = compactSnapshot(snap)
		}
	}

	// ── 5. Atlas-relevant resources ──
	// Fold the bundle we just assembled into the atlas query:
	//   - goalText derived from ActiveGoal (kind + company/text fields)
	//   - recentActivity from top kinds and recent memory episode kinds
	// Fail-soft: a broken atlas reader doesn't blank out the rest of the bundle.
	if uc.AtlasReader != nil {
		goalText := goalTextFromBundle(out.ActiveGoal)
		recentAct := recentActivityFromBundle(out)
		if refs, err := uc.AtlasReader.TopRelevantNodes(ctx, in.UserID, goalText, recentAct, 5); err == nil {
			out.RelevantResources = refs
		}
	}

	// ── 6. Wave 15: 24h activity snapshot. Fail-soft.
	if uc.RecentActivity != nil {
		if snap, err := uc.RecentActivity.Last24h(ctx, in.UserID); err == nil {
			out.RecentActivity24h = snap
		}
	}

	return out, nil
}

// goalTextFromBundle assembles a single-line "what the user is trying to
// achieve" string from the active goal. Empty when no goal is set —
// atlas reader then falls back to weakest-axis match.
func goalTextFromBundle(g *domain.PrimaryGoal) string {
	if g == nil {
		return ""
	}
	parts := make([]string, 0, 4)
	parts = append(parts, string(g.Kind))
	if g.TargetCompany != "" {
		parts = append(parts, g.TargetCompany)
	}
	if g.TargetLevel != "" {
		parts = append(parts, g.TargetLevel)
	}
	if g.TargetText != "" {
		parts = append(parts, g.TargetText)
	}
	return strings.Join(parts, " ")
}

// recentActivityFromBundle distills the bundle's recent signals into a
// flat list of activity kinds. Atlas reader uses this to boost nodes whose
// section/cluster overlaps the user's recent attention.
func recentActivityFromBundle(b UserContextBundle) []ActivityKind {
	seen := make(map[string]struct{}, 8)
	out := make([]ActivityKind, 0, 8)
	addKind := func(k string) {
		k = strings.TrimSpace(strings.ToLower(k))
		if k == "" {
			return
		}
		if _, dup := seen[k]; dup {
			return
		}
		seen[k] = struct{}{}
		out = append(out, ActivityKind(k))
	}
	for _, k := range b.Activity.TopKinds {
		addKind(k)
	}
	for _, m := range b.RecentMemory {
		addKind(m.Kind)
	}
	// Weakest radar axis is also a strong "what to recommend next" signal.
	addKind(b.Radar.WeakestAxis)
	return out
}

func (uc *GetUserContext) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

// ── Helpers ──────────────────────────────────────────────────────────────

// truncateLine collapses whitespace + caps at maxRunes. Used so a stray
// multi-paragraph episode summary doesn't blow the prompt token budget.
func truncateLine(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	// Collapse newlines → spaces.
	s = strings.ReplaceAll(s, "\r\n", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	// Collapse multi-space runs.
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "…"
}

// topKindsFromTouches derives top-5 most-frequent atlas_node prefixes
// from a ResourceEngagement bundle. Falls back to resource kinds when
// atlas_node_id is empty (cross-cluster suggestions).
func topKindsFromTouches(eng domain.ResourceEngagement) []string {
	counts := make(map[string]int, 16)
	collect := func(rs []domain.ResourceTouch) {
		for _, r := range rs {
			key := strings.TrimSpace(r.AtlasNodeID)
			if key == "" {
				key = r.Kind
			}
			if key == "" {
				continue
			}
			// First two segments of dotted atlas ids ("algo.sorting.merge"
			// → "algo.sorting") group better than full leaf node ids —
			// the LLM sees patterns, not raw paths.
			if idx := strings.IndexByte(key, '.'); idx > 0 {
				rest := key[idx+1:]
				if jdx := strings.IndexByte(rest, '.'); jdx > 0 {
					key = key[:idx+1+jdx]
				}
			}
			counts[key]++
		}
	}
	collect(eng.FinishedRecent)
	collect(eng.MarkedUnhelpful)
	collect(eng.RecentReflections)
	if len(counts) == 0 {
		return nil
	}
	type kv struct {
		k string
		v int
	}
	pairs := make([]kv, 0, len(counts))
	for k, v := range counts {
		pairs = append(pairs, kv{k, v})
	}
	slices.SortStableFunc(pairs, func(a, b kv) int {
		if a.v != b.v {
			return cmp.Compare(b.v, a.v) // desc by count
		}
		return cmp.Compare(a.k, b.k) // asc by key as tiebreak
	})
	limit := min(5, len(pairs))
	out := make([]string, 0, limit)
	for _, p := range pairs[:limit] {
		out = append(out, p.k)
	}
	return out
}

// compactSnapshot collapses SkillRadarSnapshot into the flatter view
// the proto wire-format uses. Also picks weakest/strongest axes for
// quick prompt phrasing.
func compactSnapshot(in SkillRadarSnapshot) SkillRadarView {
	out := SkillRadarView{Rubric: in.Rubric}
	if len(in.Axes) == 0 {
		return out
	}
	out.Axes = make([]string, 0, len(in.Axes))
	out.AxisScores = make([]float64, 0, len(in.Axes))
	weakestIdx, strongestIdx := -1, -1
	weakestScore, strongestScore := 2.0, -1.0
	for i, ax := range in.Axes {
		out.Axes = append(out.Axes, ax.Key)
		out.AxisScores = append(out.AxisScores, ax.Score)
		// Only count axes the user actually mocked; empty axes (Confidence
		// == empty / 0 mocks) shouldn't be flagged as "weakest" — they're
		// just unknown.
		if ax.MockCount == 0 {
			continue
		}
		if ax.Score < weakestScore {
			weakestScore = ax.Score
			weakestIdx = i
		}
		if ax.Score > strongestScore {
			strongestScore = ax.Score
			strongestIdx = i
		}
	}
	if weakestIdx >= 0 {
		out.WeakestAxis = in.Axes[weakestIdx].Key
	}
	if strongestIdx >= 0 {
		out.StrongestAxis = in.Axes[strongestIdx].Key
	}
	return out
}
