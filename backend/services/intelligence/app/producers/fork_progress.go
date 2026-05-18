// Package producers.7d insight-producers (learning-companion).
//
// Каждый producer — pure deterministic функция: ForkProgressSnapshot /
// ResourceEngagement → []Insight. LLM-enrichment (TaskAssistantForkAnalysis
// / TaskAssistantNextAction) делается layer выше — в DailyBrief synthesiser
// или Coach hero UC, через output этих producer'ов как сигнал «есть pattern
// о котором стоит сказать LLM'ке».
//
// Why так: Insight stream должен оставаться idempotent + cheap; LLM-call'ы
// гнать на каждое cron-tick'е — burn'им rate-limit. LLM зовётся только
// когда Insight доходит до user-facing surface (Coach hero, daily-brief).
package producers

import (
	"fmt"
	"time"

	"druz9/intelligence/domain"
)

// FromForkProgress эмитит insight о текущем fork-pattern'е. Active только
// когда mode='explore' и есть достаточно сигнала, чтобы рекомендовать
// commit на одну ветку (или предупредить «слишком рано выбираешь»).
//
// Anchor stable per (user, week) — повторные cron-tick'и не дублируют.
//
// Severity rules:
//   - confidence >= 0.7  → warn  («ты лезешь в DE — может быть пора commit»)
//   - confidence 0.4-0.7 → nudge («есть лёгкий lean, продолжай explore»)
//   - confidence < 0.4   → cruise (тихий sigh «ещё рано судить»)
//
// LLM-enrichment: Coach hero берёт этот Insight как сигнал и
// зовёт TaskAssistantForkAnalysis с подробностями для narrative ответа.
func FromForkProgress(snap domain.ForkProgressSnapshot, now time.Time) []domain.Insight {
	if snap.Mode != "explore" {
		return nil
	}
	leanBranch, confidence := computeFork(snap)
	if leanBranch == "" {
		return nil
	}

	var sev domain.InsightSeverity
	switch {
	case confidence >= 0.7:
		sev = domain.InsightSeverityWarn
	case confidence >= 0.4:
		sev = domain.InsightSeverityNudge
	default:
		sev = domain.InsightSeverityCruise
	}

	weekTag := now.Format("2006-W") + fmt.Sprintf("%02d", isoWeek(now))
	anchor := fmt.Sprintf("fork:%s:%s", leanBranch, weekTag)

	return []domain.Insight{{
		Surface:  domain.InsightSurfaceToday,
		Severity: sev,
		Anchor:   anchor,
		Headline: fmt.Sprintf("Fork lean → %s · confidence %.2f (week %d)",
			leanBranch, confidence, snap.ExploreWeekIndex),
		Evidence: forkEvidence(snap),
		Interpret: fmt.Sprintf("Across explore window: %s side has stronger signals.",
			leanBranch),
		Lever:     fmt.Sprintf("Try a %s mock + 1 deep-dive resource. If lean still holds → commit.", leanBranch),
		DeepLink:  "/coach",
		ExpiresAt: now.Add(7 * 24 * time.Hour),
	}}
}

// computeFork — простая deterministic эвристика: сравнить avg score x mock
// count + voluntary deep dives. Confidence = max margin / total.
//
// LLM-version (TaskAssistantForkAnalysis) даст более nuanced confidence
// с учётом trend / time-spent / engagement signals; здесь — baseline.
func computeFork(snap domain.ForkProgressSnapshot) (string, float64) {
	if len(snap.ScoresByBranch) < 2 {
		return "", 0
	}
	type score struct {
		branch string
		val    float64
	}
	scores := make([]score, 0, len(snap.ScoresByBranch))
	for _, b := range snap.ScoresByBranch {
		// mock score weighed на count (один mock 90 — слабее чем три по 75)
		// + 8 баллов за каждый voluntary deep-dive (capped at 40).
		dives := b.VoluntaryDeepDives * 8
		if dives > 40 {
			dives = 40
		}
		v := b.AvgScore*float64(b.MockCount) + float64(dives)
		scores = append(scores, score{branch: b.Branch, val: v})
	}
	if scores[0].val == 0 && scores[1].val == 0 {
		return "", 0
	}

	hi, lo := scores[0], scores[1]
	if lo.val > hi.val {
		hi, lo = lo, hi
	}
	total := hi.val + lo.val
	if total == 0 {
		return "", 0
	}
	confidence := (hi.val - lo.val) / total
	if confidence < 0 {
		confidence = 0
	}
	if confidence > 1 {
		confidence = 1
	}
	return hi.branch, confidence
}

func forkEvidence(snap domain.ForkProgressSnapshot) string {
	parts := make([]string, 0, len(snap.ScoresByBranch))
	for _, b := range snap.ScoresByBranch {
		parts = append(parts, fmt.Sprintf("%s: %d mocks (avg %.0f), %d deep-dives",
			b.Branch, b.MockCount, b.AvgScore, b.VoluntaryDeepDives))
	}
	join := ""
	for i, p := range parts {
		if i > 0 {
			join += " · "
		}
		join += p
	}
	return join
}

func isoWeek(t time.Time) int {
	_, w := t.ISOWeek()
	return w
}
