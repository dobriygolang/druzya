// anti-suggestion-fatigue cooldown tests.
package infra

import (
	"testing"
	"time"

	"druz9/intelligence/domain"
)

func dismissEpisode(at time.Time, kind domain.RecommendationKind) domain.Episode {
	payload := []byte(`{"brief_id":"x","index":0,"rec_kind":"` + string(kind) + `","target_id":""}`)
	return domain.Episode{
		Kind:       domain.EpisodeBriefDismissed,
		OccurredAt: at,
		Summary:    "Some recommendation",
		Payload:    payload,
	}
}

func TestCooledDownKinds_BelowThresholdEmpty(t *testing.T) {
	now := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		dismissEpisode(now.AddDate(0, 0, -1), domain.RecommendationTinyTask),
		dismissEpisode(now.AddDate(0, 0, -2), domain.RecommendationTinyTask),
	}
	got := cooledDownKinds(past, now, 14, 3)
	if len(got) != 0 {
		t.Fatalf("expected no cooldown for 2 dismissals, got %v", got)
	}
}

func TestCooledDownKinds_ThresholdHitTriggers(t *testing.T) {
	now := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		dismissEpisode(now.AddDate(0, 0, -1), domain.RecommendationTinyTask),
		dismissEpisode(now.AddDate(0, 0, -3), domain.RecommendationTinyTask),
		dismissEpisode(now.AddDate(0, 0, -8), domain.RecommendationTinyTask),
	}
	got := cooledDownKinds(past, now, 14, 3)
	if _, ok := got[domain.RecommendationTinyTask]; !ok {
		t.Fatalf("expected tiny_task in cooldown set, got %v", got)
	}
}

func TestCooledDownKinds_OutsideWindowIgnored(t *testing.T) {
	now := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		// Two recent dismissals (in window) + one ancient — total 3 raw,
		// but only 2 inside the 14-day window → no cooldown.
		dismissEpisode(now.AddDate(0, 0, -1), domain.RecommendationTinyTask),
		dismissEpisode(now.AddDate(0, 0, -3), domain.RecommendationTinyTask),
		dismissEpisode(now.AddDate(0, 0, -25), domain.RecommendationTinyTask),
	}
	got := cooledDownKinds(past, now, 14, 3)
	if len(got) != 0 {
		t.Fatalf("expected no cooldown when 3rd hit is outside window, got %v", got)
	}
}

func TestCooledDownKinds_PerKindIndependent(t *testing.T) {
	// 3 schedule dismissals + 2 tiny_task → only schedule gets cooldown,
	// другие kinds свободны.
	now := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		dismissEpisode(now.AddDate(0, 0, -1), domain.RecommendationSchedule),
		dismissEpisode(now.AddDate(0, 0, -2), domain.RecommendationSchedule),
		dismissEpisode(now.AddDate(0, 0, -3), domain.RecommendationSchedule),
		dismissEpisode(now.AddDate(0, 0, -1), domain.RecommendationTinyTask),
		dismissEpisode(now.AddDate(0, 0, -2), domain.RecommendationTinyTask),
	}
	got := cooledDownKinds(past, now, 14, 3)
	if _, ok := got[domain.RecommendationSchedule]; !ok {
		t.Fatalf("expected schedule cooldown, got %v", got)
	}
	if _, ok := got[domain.RecommendationTinyTask]; ok {
		t.Fatalf("tiny_task should not be cooled down at 2 hits, got %v", got)
	}
}

func TestCooledDownKinds_NonDismissEpisodesIgnored(t *testing.T) {
	now := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		// brief_followed should NOT count toward fatigue.
		{
			Kind:       domain.EpisodeBriefFollowed,
			OccurredAt: now.AddDate(0, 0, -1),
			Payload:    []byte(`{"rec_kind":"tiny_task"}`),
		},
		{
			Kind:       domain.EpisodeBriefFollowed,
			OccurredAt: now.AddDate(0, 0, -2),
			Payload:    []byte(`{"rec_kind":"tiny_task"}`),
		},
		{
			Kind:       domain.EpisodeBriefFollowed,
			OccurredAt: now.AddDate(0, 0, -3),
			Payload:    []byte(`{"rec_kind":"tiny_task"}`),
		},
	}
	got := cooledDownKinds(past, now, 14, 3)
	if len(got) != 0 {
		t.Fatalf("followed episodes must not trigger cooldown, got %v", got)
	}
}
