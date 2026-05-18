// confusion_pickup.go — daily producer.
//
// Reflections с confusion_flag=true → AI-tutor ping. Headline цитирует
// confusion_text для context. DeepLink в /tutor с pre-filled message.
//
// Latency: producer не ждёт LLM — pure signal-driven. AI-tutor сам
// pick'нет это insight как seed для conversation.
package producers

import (
	"fmt"
	"time"

	"druz9/intelligence/domain"
)

type ConfusionEvent struct {
	UserID        string
	AtlasNodeID   string
	ResourceURL   string
	ConfusionText string
	OccurredAt    time.Time
}

func FromConfusionPickup(events []ConfusionEvent, now time.Time) []domain.Insight {
	out := make([]domain.Insight, 0, len(events))
	day := now.Format("2006-01-02")
	for _, e := range events {
		hl := "Confusion flagged — open tutor to unstick."
		if e.ConfusionText != "" {
			snippet := e.ConfusionText
			if len(snippet) > 80 {
				snippet = snippet[:80] + "…"
			}
			hl = "«" + snippet + "» — open tutor to unstick."
		}
		out = append(out, domain.Insight{
			Surface:   domain.InsightSurfaceToday,
			Severity:  domain.InsightSeverityNudge,
			Anchor:    fmt.Sprintf("confusion:%s:%s", e.AtlasNodeID, day),
			Headline:  hl,
			Evidence:  fmt.Sprintf("Reflection on %s flagged confusion.", e.ResourceURL),
			Interpret: "Direct AI-tutor session faster than re-reading.",
			Lever:     "Open tutor with this confusion as seed.",
			DeepLink:  "/tutor?seed=" + e.AtlasNodeID,
			ExpiresAt: now.Add(48 * time.Hour),
		})
	}
	return out
}
