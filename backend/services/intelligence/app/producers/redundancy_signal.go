// redundancy_signal.go — Phase 3.5 weekly producer.
//
// Pattern: ≥3 finished resources с overlapping topics_covered + average
// quality ≥ 0.85 → user уже well-covered, можно move on.
//
// Anti-pattern для over-learners: бесконечно перечитывают one cluster.
// Insight «well-covered, can move on».
package producers

import (
	"fmt"
	"time"

	"druz9/intelligence/domain"
)

type RedundancyCluster struct {
	Topic      string   // atlas_node_id
	Resources  []string // URLs
	AvgQuality float32
}

func FromRedundancySignal(clusters []RedundancyCluster, now time.Time) []domain.Insight {
	out := make([]domain.Insight, 0, len(clusters))
	week := now.Format("2006-01-W02")
	for _, c := range clusters {
		if len(c.Resources) < 3 || c.AvgQuality < 0.85 {
			continue
		}
		out = append(out, domain.Insight{
			Surface:   domain.InsightSurfaceToday,
			Severity:  domain.InsightSeverityNudge,
			Anchor:    fmt.Sprintf("redundancy:%s:%s", c.Topic, week),
			Headline:  fmt.Sprintf("Well-covered «%s» — %d resources at avg %.0f%%.", c.Topic, len(c.Resources), c.AvgQuality*100),
			Evidence:  fmt.Sprintf("Last %d finished resources on this topic graded ≥ 0.85.", len(c.Resources)),
			Interpret: "Diminishing returns — diversify into next prereq-chain.",
			Lever:     "Pick a depth-deep resource on adjacent topic.",
			DeepLink:  "/atlas",
			ExpiresAt: now.Add(14 * 24 * time.Hour),
		})
	}
	return out
}
