// Tests for StartPractice.Do — instant single-player match creation.
//
// The use case is small but its persistence side-effect is load-bearing
// (frontend navigates straight to /arena/match/:id), so the tests pin
// down: (1) section validation, (2) task-pick failure propagation,
// (3) the persisted match has status=active + StartedAt set, (4) the
// neural-model hint round-trips into OpponentLabel.
package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/arena/domain"
	"druz9/arena/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestStartPractice_InvalidSection(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	matches := mocks.NewMockMatchRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	uc := &StartPractice{Matches: matches, Tasks: tasks, Clock: domain.RealClock{}}

	_, err := uc.Do(context.Background(), StartPracticeInput{
		UserID:  uuid.New(),
		Section: enums.Section("not-a-section"),
	})
	if err == nil {
		t.Fatalf("expected invalid-section error, got nil")
	}
}

func TestStartPractice_PickTaskFails(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	matches := mocks.NewMockMatchRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	tasks.EXPECT().
		PickBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return(domain.TaskPublic{}, errors.New("no tasks for section"))

	uc := &StartPractice{Matches: matches, Tasks: tasks, Clock: domain.RealClock{}}
	_, err := uc.Do(context.Background(), StartPracticeInput{
		UserID:  uuid.New(),
		Elo:     1200,
		Section: enums.SectionAlgorithms,
	})
	if err == nil || !contains(err.Error(), "pick task") {
		t.Fatalf("expected wrapped pick-task error, got %v", err)
	}
}

func TestStartPractice_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	matches := mocks.NewMockMatchRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)

	taskID := uuid.New()
	matchID := uuid.New()
	uid := uuid.New()
	now := time.Date(2026, 4, 23, 10, 0, 0, 0, time.UTC)
	clk := &domain.FixedClock{T: now}

	tasks.EXPECT().
		PickBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return(domain.TaskPublic{ID: taskID, Version: 1, Section: enums.SectionAlgorithms}, nil)

	matches.EXPECT().
		CreateMatch(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, m domain.Match, parts []domain.Participant) (domain.Match, error) {
			if m.Status != enums.MatchStatusActive {
				t.Fatalf("expected active status, got %s", m.Status)
			}
			if m.Mode != enums.ArenaModeSolo1v1 {
				t.Fatalf("expected solo_1v1 mode, got %s", m.Mode)
			}
			if m.StartedAt == nil || !m.StartedAt.Equal(now) {
				t.Fatalf("expected StartedAt=%v, got %v", now, m.StartedAt)
			}
			if len(parts) != 1 || parts[0].UserID != uid {
				t.Fatalf("expected single participant for user %s, got %+v", uid, parts)
			}
			m.ID = matchID
			return m, nil
		})

	uc := &StartPractice{Matches: matches, Tasks: tasks, Clock: clk}
	out, err := uc.Do(context.Background(), StartPracticeInput{
		UserID:      uid,
		Elo:         1200,
		Section:     enums.SectionAlgorithms,
		NeuralModel: "claude",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if out.MatchID != matchID {
		t.Fatalf("expected match id %s, got %s", matchID, out.MatchID)
	}
	if out.OpponentLabel != "Sonnet 4.5 bot" {
		t.Fatalf("expected sonnet opponent label, got %q", out.OpponentLabel)
	}
	if out.Status != enums.MatchStatusActive {
		t.Fatalf("expected active status, got %s", out.Status)
	}
}

func TestOpponentLabelFor(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"llama3":  "Llama 3 bot",
		"claude":  "Sonnet 4.5 bot",
		"gpt4":    "GPT-4o bot",
		"random":  "Random LLM bot",
		"":        "AI bot",
		"unknown": "AI bot",
	}
	for in, want := range cases {
		if got := opponentLabelFor(in); got != want {
			t.Errorf("opponentLabelFor(%q)=%q, want %q", in, got, want)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
