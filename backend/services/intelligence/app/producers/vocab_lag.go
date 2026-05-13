// vocab_lag.go — Wave 15 cross-vertical producer.
//
// Trigger: SRS vocab queue имеет cards с next_review_at в прошлом, но
// юзер давно не review'ил. ≥4 дней без review → утреннее напоминание.
// Идея — SRS забывание-кривая: пропуск окна review → нужно пересдать.
//
// Severity:
//   - 4-6 дней + ≥10 due cards → nudge
//   - 7+ дней OR ≥30 due cards → warn
//   - 14+ дней OR ≥60 due cards → critical
//
// Anchor стабильный по дню чтобы daily-cron не дублировал. Reader
// (intelligence/infra) собирает агрегаты из hone_vocab_queue.
package producers

import (
	"fmt"
	"time"

	"druz9/intelligence/domain"
)

// VocabLagSnapshot — projection 7d-30d vocab review pattern.
type VocabLagSnapshot struct {
	// TotalCards — total active rows in hone_vocab_queue.
	TotalCards int
	// DueCards — rows where next_review_at <= now.
	DueCards int
	// DaysSinceLastReview — days с последнего reviewed_at update.
	// -1 если юзер ничего не review'ил никогда (или нет данных).
	DaysSinceLastReview int
}

// FromVocabLag → 0..1 insight. Empty queue → пусто (не nudge'аем тех,
// кто не enrolled). Пустой LastReview но непустая queue → особый case
// (welcome-back framing).
func FromVocabLag(s VocabLagSnapshot, now time.Time) []domain.Insight {
	if s.TotalCards == 0 {
		return nil
	}
	day := now.Format("2006-01-02")

	// «Never reviewed» — есть карты, но не было ни одного review.
	// Особый case: коуч приглашает начать.
	if s.DaysSinceLastReview < 0 {
		if s.DueCards == 0 {
			return nil
		}
		return []domain.Insight{{
			Surface:  domain.InsightSurfaceToday,
			Severity: domain.InsightSeverityNudge,
			Anchor:   fmt.Sprintf("vocab:never-reviewed:%s", day),
			Headline: fmt.Sprintf("%d vocab-cards ждут review.", s.DueCards),
			Evidence: fmt.Sprintf("В queue %d карточек, ни одна ещё не review'нута.", s.TotalCards),
			Interpret: "SRS работает только если карты проходят review-цикл; иначе queue — это just-a-list.",
			Lever:    "Lingua → Vocab → 5 минут review (10-15 карт).",
			DeepLink: "/lingua/vocab",
			ExpiresAt: now.Add(48 * time.Hour),
		}}
	}

	// Severity escalation по days + due-count.
	if s.DaysSinceLastReview < 4 || s.DueCards < 10 {
		return nil
	}

	sev := domain.InsightSeverityNudge
	switch {
	case s.DaysSinceLastReview >= 14 || s.DueCards >= 60:
		sev = domain.InsightSeverityCritical
	case s.DaysSinceLastReview >= 7 || s.DueCards >= 30:
		sev = domain.InsightSeverityWarn
	}

	return []domain.Insight{{
		Surface:  domain.InsightSurfaceToday,
		Severity: sev,
		Anchor:   fmt.Sprintf("vocab:lag:%s", day),
		Headline: fmt.Sprintf(
			"%d дней без vocab-review · %d cards due.",
			s.DaysSinceLastReview, s.DueCards,
		),
		Evidence: fmt.Sprintf(
			"Последний review %d дней назад; %d из %d cards уже past their review window.",
			s.DaysSinceLastReview, s.DueCards, s.TotalCards,
		),
		Interpret: "Кривая забывания работает против тебя — каждый день без review снимает retention.",
		Lever:     "Lingua → Vocab → 5 минут review (≤15 cards) сейчас.",
		DeepLink:  "/lingua/vocab",
		ExpiresAt: now.Add(36 * time.Hour),
	}}
}
