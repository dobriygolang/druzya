// english_pattern.go — Wave 15 cross-vertical producer.
//
// Trigger: user читает (SRS vocab + reading) подряд несколько дней, но
// Speaking grade падает либо отсутствует. Сигнал: pronunciation/fluency
// плохо коррелируют с reading volume → нужна shadowing практика.
//
// Severity escalation:
//   - 5+ дней reading-streak без single Speaking attempt за окно → warn (4)
//   - Speaking avg < 50% за 3+ attempts в окне (после reading streak) → warn (4)
//   - 3-4 reading-дней + Speaking avg < 60% → nudge (2)
//
// Anchor стабильный по дню чтобы daily-cron не дублировал. Идея в том
// чтобы coach next-action поднял speaking_drill, а не review-resource.
package producers

import (
	"fmt"
	"time"

	"druz9/intelligence/domain"
)

// EnglishActivity — projection 7-дневной English активности юзера.
// Reader (intelligence/infra) собирает из hone_reading_sessions +
// hone_vocab_queue + speaking_sessions.
type EnglishActivity struct {
	// ReadingDaysLast7 — distinct YYYY-MM-DD дней с ≥1 reading_session.
	ReadingDaysLast7 int
	// VocabReviewedLast7 — distinct YYYY-MM-DD дней с ≥1 hone_vocab_queue.reviewed_at.
	VocabReviewedLast7 int
	// SpeakingAttempts7d — count(*) FROM speaking_sessions за 7 дней.
	SpeakingAttempts7d int
	// SpeakingAvgScore7d — AVG((pronunciation+fluency)/2) over 7d window,
	// 0..100. 0 means "no attempts".
	SpeakingAvgScore7d float64
	// LastSpeakingAt — для «N days since speaking» framing.
	LastSpeakingAt time.Time
}

// FromEnglishPattern → cross-vertical Reading↔Speaking insights.
//
// Returns 0..1 insight (single dominant signal — мы не хотим заваливать
// today-feed дублирующими). Anchor "english:reading-without-speaking:%s"
// or "english:speaking-low:%s" по дню.
func FromEnglishPattern(a EnglishActivity, now time.Time) []domain.Insight {
	day := now.Format("2006-01-02")

	// Case 1: reading streak без speaking — самый чёткий сигнал.
	if a.ReadingDaysLast7 >= 5 && a.SpeakingAttempts7d == 0 {
		return []domain.Insight{{
			Surface:  domain.InsightSurfaceToday,
			Severity: domain.InsightSeverityWarn,
			Anchor:   fmt.Sprintf("english:reading-without-speaking:%s", day),
			Headline: fmt.Sprintf(
				"%d дней чтения, 0 раз speaking — pronunciation drift.",
				a.ReadingDaysLast7,
			),
			Evidence: fmt.Sprintf(
				"%d reading-дней + %d vocab-дней за 7 дней, но 0 speaking attempts.",
				a.ReadingDaysLast7, a.VocabReviewedLast7,
			),
			Interpret: "Input без output — vocab узнаётся, но не выпрыгивает в речь.",
			Lever:     "Lingua → Speaking → одно shadowing-упражнение (10 мин).",
			DeepLink:  "/lingua/speaking",
			ExpiresAt: now.Add(48 * time.Hour),
		}}
	}

	// Case 2: speaking attempts есть, но средний score низкий — pronunciation gap.
	if a.SpeakingAttempts7d >= 3 && a.SpeakingAvgScore7d > 0 && a.SpeakingAvgScore7d < 50 {
		return []domain.Insight{{
			Surface:  domain.InsightSurfaceToday,
			Severity: domain.InsightSeverityWarn,
			Anchor:   fmt.Sprintf("english:speaking-low:%s", day),
			Headline: fmt.Sprintf(
				"Speaking avg %.0f/100 за %d попыток — нужна целевая работа.",
				a.SpeakingAvgScore7d, a.SpeakingAttempts7d,
			),
			Evidence: fmt.Sprintf(
				"%d shadowing-attempts за 7 дней, средний score %.0f.",
				a.SpeakingAttempts7d, a.SpeakingAvgScore7d,
			),
			Interpret: "Score стабильно ниже 50 — это не плохой день, это паттерн.",
			Lever:     "Lingua → Speaking → выбери B1-prompt и проговори 3 раза подряд.",
			DeepLink:  "/lingua/speaking",
			ExpiresAt: now.Add(48 * time.Hour),
		}}
	}

	// Case 3: модерация — 3-4 дня reading + умеренный speaking score.
	if a.ReadingDaysLast7 >= 3 && a.SpeakingAttempts7d > 0 &&
		a.SpeakingAvgScore7d > 0 && a.SpeakingAvgScore7d < 60 {
		return []domain.Insight{{
			Surface:  domain.InsightSurfaceToday,
			Severity: domain.InsightSeverityNudge,
			Anchor:   fmt.Sprintf("english:speaking-lag:%s", day),
			Headline: fmt.Sprintf(
				"Speaking %.0f/100 при %d днях чтения — отстаёт.",
				a.SpeakingAvgScore7d, a.ReadingDaysLast7,
			),
			Evidence: fmt.Sprintf(
				"Reading на ходу (%d дней), а speaking score %.0f за %d attempts.",
				a.ReadingDaysLast7, a.SpeakingAvgScore7d, a.SpeakingAttempts7d,
			),
			Interpret: "Receptive > productive. Добавь speaking в daily routine.",
			Lever:     "10 минут shadowing в Lingua сегодня.",
			DeepLink:  "/lingua/speaking",
			ExpiresAt: now.Add(48 * time.Hour),
		}}
	}

	return nil
}
