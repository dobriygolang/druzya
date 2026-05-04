// gap_detection.go — Phase 3.5 daily producer.
//
// Pattern: user продвигается к next-step но prereq atlas-узлы НЕ confirmed
// (no coverage insight в последние N дней). Emit warn-severity insight
// «before next step, close gap on X».
//
// Reader выдаёт current-step prereqs + confirmed-set. Diff = gap.
package producers

import (
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"
)

type GapEvent struct {
	UserID       string
	NextStep     string
	MissingNodes []string // atlas_node_ids — prereqs без confirmed coverage
}

func FromGapDetection(ev GapEvent, now time.Time) []domain.Insight {
	if len(ev.MissingNodes) == 0 {
		return nil
	}
	day := now.Format("2006-01-02")
	headline := fmt.Sprintf("Before «%s», close gap on %s.", ev.NextStep, ev.MissingNodes[0])
	if len(ev.MissingNodes) > 1 {
		headline = fmt.Sprintf("Before «%s», %d prereqs unconfirmed.", ev.NextStep, len(ev.MissingNodes))
	}
	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  domain.InsightSeverityWarn,
		Anchor:    fmt.Sprintf("gap:%s:%s", ev.NextStep, day),
		Headline:  headline,
		Evidence:  "Missing: " + strings.Join(ev.MissingNodes, ", "),
		Interpret: "Skip prereqs → fragile next-step. Coach can sequence resources.",
		Lever:     "Open atlas → spend 1 pomodoro on first missing node.",
		DeepLink:  "/atlas",
		ExpiresAt: now.Add(72 * time.Hour),
	}}
}
