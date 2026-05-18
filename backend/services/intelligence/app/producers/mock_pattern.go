// mock_pattern.go — cross-vertical producer.
//
// Trigger: одна и та же mock-секция (sysdesign / algorithms / ml_coding)
// fail'ится 3+ раз подряд. Сигнал: атлас struggle + push в next_action.
//
// «Подряд» означает в окне (last N completed mocks), все из этой секции
// → fail; не requires literally consecutive — позволяем редкие mocks
// в других секциях между ними.
//
// Severity:
//   - 3 fails → warn (4)
//   - 4+ fails → critical (5)
//
// Anchor стабильный по секции, без даты — повторный fail на той же секции
// апсёртится в ту же строку, не дублируя card.
package producers

import (
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"
)

// FromMockPattern — анализирует last N mocks (newest first). Возвращает
// 0..1 insight для самой провальной секции (по count). Score threshold
// для «fail» — 50 (mock_session.ai_report.score 0..100). Empty/zero score
// игнорируется (mock без AI-report не считается ни fail ни success).
func FromMockPattern(mocks []domain.MockSessionSummary, now time.Time) []domain.Insight {
	if len(mocks) == 0 {
		return nil
	}

	// Counts fails per section в last 8 mocks (окно covers ~2 недели
	// типичной активности).
	failsBySection := make(map[string]int)
	for i, m := range mocks {
		if i >= 8 {
			break
		}
		section := strings.TrimSpace(strings.ToLower(m.Section))
		if section == "" {
			continue
		}
		// Treat score 0 как «no rating» — пропускаем. Только явный fail.
		if m.Score > 0 && m.Score < 50 {
			failsBySection[section]++
		}
	}

	// Pick section with max fails (≥3).
	var topSection string
	topCount := 0
	for s, c := range failsBySection {
		if c > topCount {
			topSection = s
			topCount = c
		}
	}
	if topCount < 3 {
		return nil
	}

	sev := domain.InsightSeverityWarn
	if topCount >= 4 {
		sev = domain.InsightSeverityCritical
	}

	// Map section → atlas node hint. Известные сопоставления — для
	// system_design / algorithms / ml_coding. Остальные fall'back на
	// generic /atlas link.
	atlasNode, atlasLabel := atlasHintForSection(topSection)
	deepLink := "/atlas"
	if atlasNode != "" {
		deepLink = "/atlas?focus=" + atlasNode
	}

	return []domain.Insight{{
		Surface:   domain.InsightSurfaceToday,
		Severity:  sev,
		Anchor:    fmt.Sprintf("mock:%s:fails", topSection),
		SkillKey:  topSection,
		Headline:  fmt.Sprintf("Mock %s провален %d раз — паттерн.", topSection, topCount),
		Evidence:  fmt.Sprintf("%d из последних 8 mocks в секции %q ушли в fail (<50/100).", topCount, topSection),
		Interpret: fmt.Sprintf("Это не один плохой день — узкое место именно в %s.", atlasLabel),
		Lever:     fmt.Sprintf("Открой Atlas: %s → выбери ближайший unlocked-узел и закрой 25 минутами.", atlasLabel),
		DeepLink:  deepLink,
		ExpiresAt: now.Add(96 * time.Hour),
	}}
}

// atlasHintForSection — closed-set mapping от mock_section → atlas node id.
// Хардкод намеренный: section enum'ы стабильны (ai_mock.proto), atlas
// catalog тоже. Расширяется PR'ом при добавлении новой section.
func atlasHintForSection(section string) (atlasNodeID, label string) {
	switch section {
	case "system_design", "sysdesign":
		return "system_design", "System Design"
	case "algorithms", "algo", "coding":
		return "algorithms", "Algorithms"
	case "ml_coding":
		return "ml_coding", "ML Coding"
	case "ml_system_design":
		return "ml_system_design", "ML System Design"
	case "ml_theory":
		return "ml_theory", "ML Theory"
	case "behavioral", "hr":
		return "behavioral", "Behavioral"
	case "de", "data_engineering":
		return "data_engineering", "Data Engineering"
	}
	return "", section
}
