package producers

import (
	"testing"
	"time"

	"druz9/intelligence/domain"
)

func TestFromEnglishPattern_ReadingWithoutSpeaking(t *testing.T) {
	now := time.Now().UTC()
	out := FromEnglishPattern(EnglishActivity{
		ReadingDaysLast7:   6,
		SpeakingAttempts7d: 0,
	}, now)
	if len(out) != 1 {
		t.Fatalf("want 1 insight, got %d", len(out))
	}
	if out[0].Severity != domain.InsightSeverityWarn {
		t.Errorf("want warn, got %s", out[0].Severity)
	}
	if !contains(out[0].Anchor, "english:reading-without-speaking") {
		t.Errorf("unexpected anchor %q", out[0].Anchor)
	}
}

func TestFromEnglishPattern_SpeakingLow(t *testing.T) {
	now := time.Now().UTC()
	out := FromEnglishPattern(EnglishActivity{
		ReadingDaysLast7:   2,
		SpeakingAttempts7d: 4,
		SpeakingAvgScore7d: 35,
	}, now)
	if len(out) != 1 {
		t.Fatalf("want 1 insight, got %d", len(out))
	}
	if out[0].Severity != domain.InsightSeverityWarn {
		t.Errorf("want warn, got %s", out[0].Severity)
	}
}

func TestFromEnglishPattern_QuietDay(t *testing.T) {
	if got := FromEnglishPattern(EnglishActivity{}, time.Now()); len(got) != 0 {
		t.Fatalf("zero signal → no insight; got %d", len(got))
	}
}

func TestFromMockPattern_ThreeFails(t *testing.T) {
	now := time.Now().UTC()
	mocks := []domain.MockSessionSummary{
		{Section: "system_design", Score: 30, FinishedAt: now.Add(-24 * time.Hour)},
		{Section: "system_design", Score: 25, FinishedAt: now.Add(-48 * time.Hour)},
		{Section: "system_design", Score: 40, FinishedAt: now.Add(-72 * time.Hour)},
		{Section: "algorithms", Score: 80, FinishedAt: now.Add(-96 * time.Hour)},
	}
	out := FromMockPattern(mocks, now)
	if len(out) != 1 {
		t.Fatalf("want 1 insight, got %d", len(out))
	}
	if out[0].Severity != domain.InsightSeverityWarn {
		t.Errorf("want warn, got %s", out[0].Severity)
	}
	if out[0].SkillKey != "system_design" {
		t.Errorf("want skill_key=system_design, got %q", out[0].SkillKey)
	}
}

func TestFromMockPattern_FourFailsCritical(t *testing.T) {
	now := time.Now().UTC()
	mocks := []domain.MockSessionSummary{
		{Section: "algorithms", Score: 30, FinishedAt: now},
		{Section: "algorithms", Score: 25, FinishedAt: now},
		{Section: "algorithms", Score: 40, FinishedAt: now},
		{Section: "algorithms", Score: 35, FinishedAt: now},
	}
	out := FromMockPattern(mocks, now)
	if len(out) != 1 {
		t.Fatalf("want 1, got %d", len(out))
	}
	if out[0].Severity != domain.InsightSeverityCritical {
		t.Errorf("want critical, got %s", out[0].Severity)
	}
}

func TestFromMockPattern_SinglePass(t *testing.T) {
	mocks := []domain.MockSessionSummary{
		{Section: "system_design", Score: 80, FinishedAt: time.Now()},
	}
	if got := FromMockPattern(mocks, time.Now()); len(got) != 0 {
		t.Fatalf("no fail → no insight; got %d", len(got))
	}
}

func TestFromVocabLag_NeverReviewed(t *testing.T) {
	now := time.Now().UTC()
	out := FromVocabLag(VocabLagSnapshot{
		TotalCards:          20,
		DueCards:            10,
		DaysSinceLastReview: -1,
	}, now)
	if len(out) != 1 || out[0].Severity != domain.InsightSeverityNudge {
		t.Fatalf("want 1 nudge, got %+v", out)
	}
}

func TestFromVocabLag_Warn(t *testing.T) {
	now := time.Now().UTC()
	out := FromVocabLag(VocabLagSnapshot{
		TotalCards:          50,
		DueCards:            35,
		DaysSinceLastReview: 8,
	}, now)
	if len(out) != 1 || out[0].Severity != domain.InsightSeverityWarn {
		t.Fatalf("want 1 warn, got %+v", out)
	}
}

func TestFromVocabLag_EmptyQueue(t *testing.T) {
	if got := FromVocabLag(VocabLagSnapshot{}, time.Now()); len(got) != 0 {
		t.Fatalf("empty → no insight; got %d", len(got))
	}
}
