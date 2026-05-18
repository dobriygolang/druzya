// closing-the-loop tests for computePendingFollowups.
package app

import (
	"testing"
	"time"

	"druz9/intelligence/domain"
)

func followedEpisode(at time.Time, kind domain.RecommendationKind, title, target string) domain.Episode {
	payload := []byte(`{"brief_id":"x","index":0,"rec_kind":"` + string(kind) + `","target_id":"` + target + `"}`)
	return domain.Episode{
		Kind:       domain.EpisodeBriefFollowed,
		OccurredAt: at,
		Summary:    title,
		Payload:    payload,
	}
}

func TestComputePendingFollowups_KeepsRecentReviewNote(t *testing.T) {
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		followedEpisode(now.Add(-3*time.Hour), domain.RecommendationReviewNote, "Read consistent-hashing", "note-123"),
	}
	got := computePendingFollowups(past, now, 36)
	if len(got) != 1 {
		t.Fatalf("expected 1 followup, got %d", len(got))
	}
	if got[0].Title != "Read consistent-hashing" {
		t.Fatalf("title mismatch: %q", got[0].Title)
	}
	if got[0].Kind != domain.RecommendationReviewNote {
		t.Fatalf("kind mismatch: %q", got[0].Kind)
	}
	if got[0].TargetID != "note-123" {
		t.Fatalf("target mismatch: %q", got[0].TargetID)
	}
	if got[0].HoursAgo != 3 {
		t.Fatalf("hours mismatch: %d", got[0].HoursAgo)
	}
}

func TestComputePendingFollowups_DropsScheduleAndUnblock(t *testing.T) {
	// schedule = timing-only, unblock = multi-day → не закрываются за
	// одну ночь, не должны попадать в pending follow-ups.
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		followedEpisode(now.Add(-2*time.Hour), domain.RecommendationSchedule, "Block 90 min focus", ""),
		followedEpisode(now.Add(-4*time.Hour), domain.RecommendationUnblock, "Open consistent-hashing review", "plan-1"),
	}
	got := computePendingFollowups(past, now, 36)
	if len(got) != 0 {
		t.Fatalf("expected zero followups for schedule/unblock, got %v", got)
	}
}

func TestComputePendingFollowups_DropsOutsideWindow(t *testing.T) {
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		// 5 days ago — outside 36h window.
		followedEpisode(now.Add(-5*24*time.Hour), domain.RecommendationTinyTask, "Old task", ""),
	}
	got := computePendingFollowups(past, now, 36)
	if len(got) != 0 {
		t.Fatalf("expected zero followups outside window, got %v", got)
	}
}

func TestComputePendingFollowups_CapsAtThree(t *testing.T) {
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	past := []domain.Episode{}
	for i := 0; i < 5; i++ {
		past = append(past, followedEpisode(
			now.Add(-time.Duration(i+1)*time.Hour),
			domain.RecommendationTinyTask,
			"Task "+string(rune('A'+i)),
			"",
		))
	}
	got := computePendingFollowups(past, now, 36)
	if len(got) != 3 {
		t.Fatalf("expected cap at 3 followups, got %d", len(got))
	}
}

func TestComputePendingFollowups_IgnoresDismissed(t *testing.T) {
	// brief_dismissed — не считаются closing-loop'ом.
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	past := []domain.Episode{
		{
			Kind:       domain.EpisodeBriefDismissed,
			OccurredAt: now.Add(-2 * time.Hour),
			Summary:    "Skipped task",
			Payload:    []byte(`{"rec_kind":"tiny_task","target_id":""}`),
		},
	}
	got := computePendingFollowups(past, now, 36)
	if len(got) != 0 {
		t.Fatalf("expected dismissed to be ignored, got %v", got)
	}
}
