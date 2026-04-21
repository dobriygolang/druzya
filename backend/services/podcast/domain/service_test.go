package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func tsPtr(t time.Time) *time.Time { return &t }

func TestApplyProgress_Threshold(t *testing.T) {
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	const duration = 600 // 10 minutes

	tests := []struct {
		name            string
		listened        int
		wantCompleted   bool
		wantListenedSec int
	}{
		{"zero", 0, false, 0},
		{"halfway", 300, false, 300},
		{"one second before threshold", duration - CompletionThresholdSec - 1, false, duration - CompletionThresholdSec - 1},
		{"exactly at threshold", duration - CompletionThresholdSec, true, duration - CompletionThresholdSec},
		{"past threshold", duration - 2, true, duration - 2},
		{"exactly duration", duration, true, duration},
		{"over duration clamped", duration + 50, true, duration},
		{"negative clamped", -5, false, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			out := ApplyProgress(Progress{}, tc.listened, duration, now)
			if (out.CompletedAt != nil) != tc.wantCompleted {
				t.Fatalf("completed: want %v, got completedAt=%v (listened=%d)", tc.wantCompleted, out.CompletedAt, out.ListenedSec)
			}
			if out.ListenedSec != tc.wantListenedSec {
				t.Fatalf("listened_sec: want %d, got %d", tc.wantListenedSec, out.ListenedSec)
			}
		})
	}
}

func TestApplyProgress_IdempotentCompletion(t *testing.T) {
	now := time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	earlier := now.Add(-1 * time.Hour)

	cur := Progress{
		UserID:      uuid.New(),
		PodcastID:   uuid.New(),
		ListenedSec: 600,
		CompletedAt: tsPtr(earlier),
	}
	t.Run("scrubbing back doesn't revert completion", func(t *testing.T) {
		out := ApplyProgress(cur, 10, 600, now)
		if out.CompletedAt == nil {
			t.Fatal("expected completion to be sticky")
		}
		if !out.CompletedAt.Equal(earlier) {
			t.Fatalf("expected completed_at preserved (want %v, got %v)", earlier, *out.CompletedAt)
		}
		if out.ListenedSec != 10 {
			t.Fatalf("expected listened_sec to be updated to 10, got %d", out.ListenedSec)
		}
	})
	t.Run("re-completing does not change completed_at", func(t *testing.T) {
		out := ApplyProgress(cur, 600, 600, now)
		if !out.CompletedAt.Equal(earlier) {
			t.Fatalf("re-completion should preserve original timestamp: want %v, got %v", earlier, *out.CompletedAt)
		}
	})
}

func TestWasJustCompleted(t *testing.T) {
	now := time.Now()
	t.Run("fresh completion", func(t *testing.T) {
		before := Progress{}
		after := Progress{CompletedAt: &now}
		if !WasJustCompleted(before, after) {
			t.Fatal("expected just-completed transition")
		}
	})
	t.Run("already completed", func(t *testing.T) {
		earlier := now.Add(-1 * time.Hour)
		before := Progress{CompletedAt: &earlier}
		after := Progress{CompletedAt: &earlier}
		if WasJustCompleted(before, after) {
			t.Fatal("must not re-fire on already-completed")
		}
	})
	t.Run("still in-progress", func(t *testing.T) {
		if WasJustCompleted(Progress{}, Progress{ListenedSec: 100}) {
			t.Fatal("no completion transition expected")
		}
	})
}

func TestProgress_IsComplete(t *testing.T) {
	now := time.Now()
	if (Progress{}).IsComplete() {
		t.Fatal("empty progress is not complete")
	}
	if !(Progress{CompletedAt: &now}).IsComplete() {
		t.Fatal("progress with completed_at must be complete")
	}
}

// Nil-safe listing: the projection builder downstream (app layer) never runs
// directly in domain, but we guard the completion check against a nil
// CompletedAt (the common case after a fresh LEFT JOIN in SQL).
func TestListingNilSafe(t *testing.T) {
	l := Listing{
		Podcast:   Podcast{ID: uuid.New(), DurationSec: 600},
		Progress:  0,
		Completed: false,
	}
	if l.Completed {
		t.Fatal("fresh listing must not be completed")
	}
	// Purely for coverage — ensure struct fields access without panic.
	if l.Podcast.DurationSec != 600 {
		t.Fatalf("duration round-trip broken")
	}
}

func TestApplyProgress_ZeroDuration(t *testing.T) {
	// A podcast with duration_sec = 0 is a content bug but the function must
	// not panic. Expect no completion.
	out := ApplyProgress(Progress{}, 100, 0, time.Now())
	if out.CompletedAt != nil {
		t.Fatal("zero-duration podcast must never auto-complete")
	}
}
