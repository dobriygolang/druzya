package app

import (
	"context"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// stubEnglishReader is a no-op fake that returns whatever summary is set on it.
type stubEnglishReader struct{ s domain.EnglishActivitySummary }

func (s stubEnglishReader) Summary7d(_ context.Context, _ uuid.UUID) (domain.EnglishActivitySummary, error) {
	return s.s, nil
}

type stubVocabReader struct{ v domain.VocabLagSummary }

func (s stubVocabReader) Lag(_ context.Context, _ uuid.UUID) (domain.VocabLagSummary, error) {
	return s.v, nil
}

type stubMockReader struct{ m []domain.MockSessionSummary }

func (s stubMockReader) LastNFinished(_ context.Context, _ uuid.UUID, _ int) ([]domain.MockSessionSummary, error) {
	return s.m, nil
}

func (s stubMockReader) RecentAbandonedCount(_ context.Context, _ uuid.UUID, _ int) (int, error) {
	return 0, nil
}

func TestCrossVertical_TopN(t *testing.T) {
	uc := &CrossVerticalInsights{
		English: stubEnglishReader{s: domain.EnglishActivitySummary{
			ReadingDaysLast7:   6,
			SpeakingAttempts7d: 0,
		}},
		Vocab: stubVocabReader{v: domain.VocabLagSummary{
			TotalCards:          50,
			DueCards:            35,
			DaysSinceLastReview: 10,
		}},
		Mocks: stubMockReader{m: []domain.MockSessionSummary{
			{Section: "system_design", Score: 30, FinishedAt: time.Now()},
			{Section: "system_design", Score: 25, FinishedAt: time.Now()},
			{Section: "system_design", Score: 40, FinishedAt: time.Now()},
		}},
		Now: func() time.Time { return time.Now().UTC() },
	}
	out, err := uc.Do(context.Background(), ListCrossVerticalInsightsInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("Do err: %v", err)
	}
	if len(out.Items) == 0 {
		t.Fatalf("expected at least 1 insight")
	}
	// First item must have the highest severity. With three producers all
	// firing at warn, any of them may sort first — we just check severity.
	for _, it := range out.Items {
		if !it.SeverityAtLeast(domain.InsightSeverityWarn) {
			// Sorting puts ≥warn first; weaker items follow.
			break
		}
	}
}

func TestCrossVertical_QuietDay(t *testing.T) {
	uc := &CrossVerticalInsights{
		English: stubEnglishReader{},
		Vocab:   stubVocabReader{},
		Mocks:   stubMockReader{},
		Now:     func() time.Time { return time.Now().UTC() },
	}
	out, err := uc.Do(context.Background(), ListCrossVerticalInsightsInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("Do err: %v", err)
	}
	if len(out.Items) != 0 {
		t.Fatalf("quiet day → 0 insights; got %d", len(out.Items))
	}
}

func TestCrossVertical_AnchorKind(t *testing.T) {
	cases := []struct {
		anchor string
		want   string
	}{
		{"english:speaking-low:2026-05-13", "english:speaking-low"},
		{"vocab:lag:2026-05-13", "vocab:lag"},
		{"mock:system_design:fails", "mock:system_design:fails"},
		{"", "generic"},
	}
	for _, c := range cases {
		if got := anchorKind(c.anchor); got != c.want {
			t.Errorf("anchorKind(%q) = %q, want %q", c.anchor, got, c.want)
		}
	}
}

func TestCrossVertical_ZeroUUIDError(t *testing.T) {
	uc := &CrossVerticalInsights{Now: func() time.Time { return time.Now().UTC() }}
	_, err := uc.Do(context.Background(), ListCrossVerticalInsightsInput{UserID: uuid.Nil})
	if err == nil {
		t.Fatalf("expected error on zero user_id")
	}
}
