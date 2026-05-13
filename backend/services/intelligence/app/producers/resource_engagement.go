package producers

import (
	"fmt"
	"time"

	"druz9/intelligence/domain"
)

// FromResourceEngagement эмитит insights про external-resource pattern:
//   - 5+ unfinished resources за окно → "ты накапливаешь open tabs"
//   - marked unhelpful с replacement candidate → "найдём замену"
//   - missing reflections на core resources → "reflection slipping"
//
// Anchor включает date-bucket (по дню) — повторные cron-tick'и в течение
// одного дня не дублируют. Severity всегда ≤ warn — это soft signals.
func FromResourceEngagement(eng domain.ResourceEngagement, now time.Time) []domain.Insight {
	out := make([]domain.Insight, 0, 2)
	day := now.Format("2006-01-02")

	if eng.UnfinishedCount >= 5 {
		sev := domain.InsightSeverityNudge
		if eng.UnfinishedCount >= 10 {
			sev = domain.InsightSeverityWarn
		}
		out = append(out, domain.Insight{
			Surface:   domain.InsightSurfaceToday,
			Severity:  sev,
			Anchor:    fmt.Sprintf("resource:unfinished:%s", day),
			Headline:  fmt.Sprintf("Open tabs piling up — %d unfinished resources.", eng.UnfinishedCount),
			Evidence:  fmt.Sprintf("%d clicked resources за окно без finished/skipped.", eng.UnfinishedCount),
			Interpret: "Inventory is leaking attention. Either close (skip) or commit (finish).",
			Lever:     "Pick 1 open resource → finish OR mark skipped. Don't add new.",
			DeepLink:  "/coach",
			ExpiresAt: now.Add(48 * time.Hour),
		})
	}

	if len(eng.MarkedUnhelpful) >= 2 {
		out = append(out, domain.Insight{
			Surface:   domain.InsightSurfaceToday,
			Severity:  domain.InsightSeverityNudge,
			Anchor:    fmt.Sprintf("resource:unhelpful:%s", day),
			Headline:  fmt.Sprintf("%d resources marked unhelpful recently.", len(eng.MarkedUnhelpful)),
			Evidence:  unhelpfulEvidence(eng.MarkedUnhelpful),
			Interpret: "Curation needs adjustment for your level/depth.",
			Lever:     "Coach can suggest replacements — ask «what should I read instead of X».",
			DeepLink:  "/coach",
			ExpiresAt: now.Add(48 * time.Hour),
		})
	}

	// «Reflection slipping»: > 2 finished без accompanying reflection.
	finishedNoReflection := 0
	reflURLs := make(map[string]struct{}, len(eng.RecentReflections))
	for _, r := range eng.RecentReflections {
		reflURLs[r.URL] = struct{}{}
	}
	for _, f := range eng.FinishedRecent {
		if _, ok := reflURLs[f.URL]; !ok {
			finishedNoReflection++
		}
	}
	if finishedNoReflection >= 3 {
		out = append(out, domain.Insight{
			Surface:   domain.InsightSurfaceToday,
			Severity:  domain.InsightSeverityNudge,
			Anchor:    fmt.Sprintf("resource:no-reflection:%s", day),
			Headline:  fmt.Sprintf("%d finished resources without reflection.", finishedNoReflection),
			Evidence:  "Skipping reflection forfeits the auto-link to atlas + AI-tutor recall.",
			Interpret: "Reading without summary = passive consumption. Pattern matters more than streak.",
			Lever:     "1-line reflection on the next resource — title + main idea is enough.",
			DeepLink:  "/notes",
			ExpiresAt: now.Add(48 * time.Hour),
		})
	}

	return out
}

func unhelpfulEvidence(touches []domain.ResourceTouch) string {
	if len(touches) == 0 {
		return ""
	}
	limit := min(3, len(touches))
	out := ""
	for i := range limit {
		if i > 0 {
			out += "; "
		}
		out += fmt.Sprintf("%s (%dh ago)", touches[i].URL, touches[i].HoursAgo)
	}
	return out
}
