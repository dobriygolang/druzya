// insights.go — atomic-card generator + reader use cases.
//
// Phase 1.5 (architecture). The brain produces a stream of Insight
// rows; web/Hone/arena/codex surfaces are thin readers over that
// stream. DailyBrief is still synthesised separately for the weekly
// recap surface, but the day-in-day UX runs on insights now.
//
// GenerateInsights is the write side. It takes the same prompt-input
// snapshot the DailyBrief synthesiser uses, walks deterministic rules,
// and Upserts one Insight per detected anchor. Anchors are stable
// across days, so the same "Yandex interview Friday" doesn't
// duplicate; existing dismissed_at survives the upsert.
//
// ListInsights is the read side. Surface filter + severity-then-recency
// ordering happens in the repo SQL.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// GenerateInsights — periodic + on-demand generator. Idempotent for
// the same (user, snapshot) input via Upsert anchor uniqueness.
type GenerateInsights struct {
	Repo domain.InsightRepo
	Now  func() time.Time
}

// GenerateInsightsInput.
type GenerateInsightsInput struct {
	UserID uuid.UUID
	// Snapshot — what the coach sees right now. Reuses the same
	// envelope the DailyBrief synthesiser consumes so generators
	// don't re-fetch readers.
	Snapshot domain.BriefPromptInput
}

// GenerateInsightsResult.
type GenerateInsightsResult struct {
	Upserted int
	Surfaces map[domain.InsightSurface]int // counts per surface
}

// Do walks the snapshot and produces 0..N insights. Pure orchestration:
// every shape decision lives in the small produce* helpers, easy to
// unit-test in isolation.
func (uc *GenerateInsights) Do(ctx context.Context, in GenerateInsightsInput) (GenerateInsightsResult, error) {
	now := uc.now().UTC()
	candidates := make([]domain.Insight, 0, 8)
	candidates = append(candidates, produceUrgentEventInsights(in, now)...)
	candidates = append(candidates, produceLongAbsenceInsight(in, now)...)
	candidates = append(candidates, produceMockTopicInsight(in, now)...)
	candidates = append(candidates, produceWeakSkillInsight(in, now)...)

	res := GenerateInsightsResult{Surfaces: map[domain.InsightSurface]int{}}
	for _, c := range candidates {
		c.UserID = in.UserID
		if c.Surface == "" {
			c.Surface = domain.InsightSurfaceToday
		}
		if !c.Severity.IsValid() {
			c.Severity = domain.InsightSeverityNudge
		}
		if c.Anchor == "" {
			continue
		}
		c.GeneratedAt = now
		if c.ExpiresAt.IsZero() {
			c.ExpiresAt = now.Add(24 * time.Hour)
		}
		if _, err := uc.Repo.Upsert(ctx, c); err != nil {
			return res, fmt.Errorf("intelligence.GenerateInsights: upsert %q: %w", c.Anchor, err)
		}
		res.Upserted++
		res.Surfaces[c.Surface]++
	}
	return res, nil
}

func (uc *GenerateInsights) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

// ListInsights — surface-scoped feed. Thin wrapper.
type ListInsights struct {
	Repo domain.InsightRepo
}

// ListInsightsInput.
type ListInsightsInput struct {
	UserID  uuid.UUID
	Surface domain.InsightSurface
	Limit   int
}

// Do executes the use case.
func (uc *ListInsights) Do(ctx context.Context, in ListInsightsInput) ([]domain.Insight, error) {
	rows, err := uc.Repo.ListLiveBySurface(ctx, in.UserID, in.Surface, in.Limit)
	if err != nil {
		return nil, fmt.Errorf("intelligence.ListInsights: %w", err)
	}
	return rows, nil
}

// AckInsight — user-feedback tap.
type AckInsight struct {
	Repo domain.InsightRepo
}

// AckInsightInput. Action 'follow' marks acted_at; 'dismiss' marks
// dismissed_at. Anything else is rejected.
type AckInsightInput struct {
	UserID    uuid.UUID
	InsightID uuid.UUID
	Action    string // 'follow' | 'dismiss'
}

// Do executes the use case.
func (uc *AckInsight) Do(ctx context.Context, in AckInsightInput) error {
	switch in.Action {
	case "follow":
		if err := uc.Repo.MarkActed(ctx, in.UserID, in.InsightID); err != nil {
			return fmt.Errorf("intelligence.AckInsight.follow: %w", err)
		}
		return nil
	case "dismiss":
		if err := uc.Repo.MarkDismissed(ctx, in.UserID, in.InsightID); err != nil {
			return fmt.Errorf("intelligence.AckInsight.dismiss: %w", err)
		}
		return nil
	default:
		return fmt.Errorf("intelligence.AckInsight: invalid action %q", in.Action)
	}
}

// ── deterministic producers ────────────────────────────────────────────
//
// One per "kind of pattern". Each returns ≤2 insights so a noisy day
// can't flood the feed; ranking happens at the read side via severity.

func produceUrgentEventInsights(in GenerateInsightsInputSnapshot, now time.Time) []domain.Insight {
	out := make([]domain.Insight, 0, 2)
	for _, ev := range in.Snapshot.UpcomingInterviews {
		if ev.DaysFromNow < 0 || ev.DaysFromNow > 7 {
			continue
		}
		var sev domain.InsightSeverity
		switch {
		case ev.DaysFromNow <= 3:
			sev = domain.InsightSeverityCritical
		case ev.DaysFromNow <= 7:
			sev = domain.InsightSeverityWarn
		default:
			continue
		}
		title := strings.TrimSpace(ev.CompanyName)
		if title == "" {
			title = strings.TrimSpace(ev.Title)
		}
		if title == "" {
			title = "Upcoming"
		}
		var when string
		switch ev.DaysFromNow {
		case 0:
			when = "today"
		case 1:
			when = "tomorrow"
		default:
			when = fmt.Sprintf("in %d days", ev.DaysFromNow)
		}
		anchor := "event:" + strings.ToLower(strings.ReplaceAll(title, " ", "_")) + "_" + ev.InterviewDate.Format("2006-01-02")
		out = append(out, domain.Insight{
			Surface:   domain.InsightSurfaceToday,
			Severity:  sev,
			Anchor:    anchor,
			Headline:  fmt.Sprintf("%s · %s · readiness %d%%", title, when, ev.ReadinessPct),
			Evidence:  fmt.Sprintf("%s in %d day(s); self-readiness %d%%.", title, ev.DaysFromNow, ev.ReadinessPct),
			Interpret: "Calendar pressure overrides every other signal until the event passes.",
			Lever:     "Run one focused mock today aimed at this company's stack.",
			DeepLink:  "/mock",
			ExpiresAt: now.Add(time.Duration(ev.DaysFromNow+1) * 24 * time.Hour),
		})
		if len(out) >= 2 {
			break
		}
	}
	return out
}

func produceLongAbsenceInsight(in GenerateInsightsInputSnapshot, now time.Time) []domain.Insight {
	days := daysSinceLastTouchSnapshot(in.Snapshot)
	if days < 14 {
		return nil
	}
	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  domain.InsightSeverityCruise,
		Anchor:    "absence:welcome_back",
		Headline:  fmt.Sprintf("Welcome back — %d days off.", days),
		Evidence:  fmt.Sprintf("Last activity %d days ago. Old mock scores and arena losses are stale.", days),
		Interpret: "Re-entry beats catch-up. One small concrete win matters more today than a perfect plan.",
		Lever:     "Do today's daily kata. That's it.",
		DeepLink:  "/arena/kata",
		ExpiresAt: now.Add(72 * time.Hour),
	}}
}

func produceMockTopicInsight(in GenerateInsightsInputSnapshot, now time.Time) []domain.Insight {
	if len(in.Snapshot.Mocks) == 0 {
		return nil
	}
	// Find the most-repeated weak topic across recent mocks.
	counts := map[string]int{}
	for _, m := range in.Snapshot.Mocks {
		for _, t := range m.WeakTopics {
			topic := strings.TrimSpace(strings.ToLower(t))
			if topic == "" {
				continue
			}
			counts[topic]++
		}
	}
	if len(counts) == 0 {
		return nil
	}
	var topTopic string
	topCount := 0
	for t, c := range counts {
		if c > topCount {
			topTopic = t
			topCount = c
		}
	}
	if topCount < 2 {
		return nil
	}
	sev := domain.InsightSeverityNudge
	if topCount >= 3 {
		sev = domain.InsightSeverityWarn
	}
	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  sev,
		Anchor:    "skill:" + topTopic,
		SkillKey:  topTopic,
		Headline:  fmt.Sprintf("%s — flagged in %d mocks.", topTopic, topCount),
		Evidence:  fmt.Sprintf("%s appeared as a weak_topic in %d recent mock report(s).", topTopic, topCount),
		Interpret: "Repeats across separate sessions — pattern, not one-off.",
		Lever:     fmt.Sprintf("One 25-min %s drill before any other work today.", topTopic),
		DeepLink:  "/mock",
		ExpiresAt: now.Add(48 * time.Hour),
	}}
}

func produceWeakSkillInsight(in GenerateInsightsInputSnapshot, now time.Time) []domain.Insight {
	if len(in.Snapshot.WeakSkills) == 0 {
		return nil
	}
	w := in.Snapshot.WeakSkills[0]
	if w.Progress > 30 {
		return nil
	}
	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  domain.InsightSeverityNudge,
		Anchor:    "skill:" + w.SkillKey,
		SkillKey:  w.SkillKey,
		Headline:  fmt.Sprintf("%s at %d/100 — Atlas low.", w.Title, w.Progress),
		Evidence:  fmt.Sprintf("%s sits at %d/100 in your Skill Atlas.", w.Title, w.Progress),
		Interpret: "Single drill won't fix it; weekly cadence will.",
		Lever:     fmt.Sprintf("Start a %s track in Atlas — pick the smallest first step.", w.Title),
		DeepLink:  "/atlas",
		ExpiresAt: now.Add(72 * time.Hour),
	}}
}

// GenerateInsightsInputSnapshot — thin alias keeping producer
// signatures readable. Both fields are read-only inside producers.
type GenerateInsightsInputSnapshot = GenerateInsightsInput

// daysSinceLastTouchSnapshot mirrors daily_brief_diagnosis.daysSinceLastTouch
// without importing infra (which would cause an inverse dep). The two
// implementations stay in sync via a unit test in app/insights_test.go.
func daysSinceLastTouchSnapshot(in domain.BriefPromptInput) int {
	var newest time.Time
	bump := func(t time.Time) {
		if t.IsZero() {
			return
		}
		if newest.IsZero() || t.After(newest) {
			newest = t
		}
	}
	for _, d := range in.FocusDays {
		if d.Seconds > 0 {
			bump(d.Day)
		}
	}
	for _, m := range in.Mocks {
		bump(m.FinishedAt)
	}
	for _, a := range in.Arena {
		bump(a.FinishedAt)
	}
	for _, c := range in.CompletedRecent {
		bump(c.PlanDate)
	}
	for _, s := range in.SkippedRecent {
		bump(s.PlanDate)
	}
	for _, r := range in.Reflections {
		bump(r.CreatedAt)
	}
	for _, n := range in.DailyNotes {
		bump(n.Day)
	}
	for _, n := range in.RecentNotes {
		bump(n.UpdatedAt)
	}
	if newest.IsZero() {
		return -1
	}
	today := in.Today.UTC().Truncate(24 * time.Hour)
	gap := today.Sub(newest.UTC().Truncate(24 * time.Hour))
	d := int(gap.Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
}
