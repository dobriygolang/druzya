// coverage_confirmation.go — daily producer.
//
// Marks atlas-node confirmed-mastered when:
//   - есть finished resource_log entry
//   - reflection_quality_score ≥ 0.7
//
// Confirmed-status фиксируется через emitted Insight kind=coverage_confirmed
// (UI окрашивает atlas-узел; нет dedicated table — lossy by design,
// confirmed-state регенерится с любого события).
package producers

import (
	"fmt"
	"time"

	"druz9/intelligence/domain"
)

// CoverageEvent — сигнал для confirmation. Reader выдаёт за окно.
type CoverageEvent struct {
	AtlasNodeID  string
	ResourceURL  string
	QualityScore float32
	OccurredAt   time.Time
}

// FromCoverageConfirmation — события с quality ≥ 0.7 → confirmed insights.
// Anchor по (atlas_node, day) — daily cron не дублирует.
func FromCoverageConfirmation(events []CoverageEvent, now time.Time) []domain.Insight {
	out := make([]domain.Insight, 0, len(events))
	day := now.Format("2006-01-02")
	seen := make(map[string]struct{})
	for _, e := range events {
		if e.QualityScore < 0.7 {
			continue
		}
		key := e.AtlasNodeID + ":" + day
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, domain.Insight{
			Surface:   domain.InsightSurfaceToday,
			Severity:  domain.InsightSeverityCruise,
			Anchor:    fmt.Sprintf("coverage:%s:%s", e.AtlasNodeID, day),
			Headline:  fmt.Sprintf("«%s» confirmed — quality %.0f%%.", e.AtlasNodeID, e.QualityScore*100),
			Evidence:  fmt.Sprintf("Reflection on %s grades at %.2f", e.ResourceURL, e.QualityScore),
			Interpret: "Concept is stick'нут — можно продвигаться к prereq-зависимым узлам.",
			Lever:     "Open atlas → next prereq-chain step.",
			DeepLink:  "/atlas",
			ExpiresAt: now.Add(7 * 24 * time.Hour),
		})
	}
	return out
}
