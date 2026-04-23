// Tests for GetMyMatches.Do — clamping, filter validation, repo error
// propagation. The use case is intentionally tiny so tests focus on the
// invariants the ports / cache layers depend on.
package app

import (
	"context"
	"errors"
	"testing"

	"druz9/arena/domain"
	"druz9/arena/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestGetMyMatches_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockMatchRepo(ctrl)
	uid := uuid.New()
	rows := []domain.MatchHistoryEntry{
		{MatchID: uuid.New(), Result: domain.MatchResultWin, LPChange: 15},
		{MatchID: uuid.New(), Result: domain.MatchResultLoss, LPChange: -10},
	}
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, 20, 0, enums.ArenaMode(""), enums.Section("")).
		Return(rows, 42, nil)

	uc := &GetMyMatches{Matches: repo}
	out, err := uc.Do(context.Background(), GetMyMatchesInput{UserID: uid})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 2 {
		t.Fatalf("items=%d", len(out.Items))
	}
	if out.Total != 42 {
		t.Fatalf("total=%d", out.Total)
	}
}

func TestGetMyMatches_EmptyResultReturnsEmptySlice(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockMatchRepo(ctrl)
	uid := uuid.New()
	// Repo returns nil — use case must coerce to empty slice (so JSON
	// renders as [] instead of null).
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, 20, 0, enums.ArenaMode(""), enums.Section("")).
		Return(nil, 0, nil)

	uc := &GetMyMatches{Matches: repo}
	out, err := uc.Do(context.Background(), GetMyMatchesInput{UserID: uid})
	if err != nil {
		t.Fatal(err)
	}
	if out.Items == nil {
		t.Fatalf("expected empty slice, got nil")
	}
	if len(out.Items) != 0 {
		t.Fatalf("expected len 0, got %d", len(out.Items))
	}
}

func TestGetMyMatches_LimitClamping(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   int
		want int
	}{
		{"zero defaults", 0, domain.HistoryDefaultLimit},
		{"negative defaults", -5, domain.HistoryDefaultLimit},
		{"above max clamps", 9999, domain.HistoryMaxLimit},
		{"in-range passes", 50, 50},
		{"max passes", domain.HistoryMaxLimit, domain.HistoryMaxLimit},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			repo := mocks.NewMockMatchRepo(ctrl)
			uid := uuid.New()
			repo.EXPECT().
				ListByUser(gomock.Any(), uid, tc.want, 0, enums.ArenaMode(""), enums.Section("")).
				Return([]domain.MatchHistoryEntry{}, 0, nil)
			uc := &GetMyMatches{Matches: repo}
			if _, err := uc.Do(context.Background(), GetMyMatchesInput{UserID: uid, Limit: tc.in}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestGetMyMatches_NegativeOffsetClampedToZero(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockMatchRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, 20, 0, enums.ArenaMode(""), enums.Section("")).
		Return([]domain.MatchHistoryEntry{}, 0, nil)

	uc := &GetMyMatches{Matches: repo}
	if _, err := uc.Do(context.Background(), GetMyMatchesInput{UserID: uid, Offset: -10}); err != nil {
		t.Fatal(err)
	}
}

func TestGetMyMatches_RepoErrorPropagatesWithFraming(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockMatchRepo(ctrl)
	uid := uuid.New()
	wantErr := errors.New("pg down")
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, 20, 0, enums.ArenaMode(""), enums.Section("")).
		Return(nil, 0, wantErr)

	uc := &GetMyMatches{Matches: repo}
	_, err := uc.Do(context.Background(), GetMyMatchesInput{UserID: uid})
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected wrapped error, got %v", err)
	}
}

func TestGetMyMatches_FiltersForwardedToRepo(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockMatchRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().
		ListByUser(gomock.Any(), uid, 20, 0, enums.ArenaModeRanked, enums.SectionGo).
		Return([]domain.MatchHistoryEntry{}, 0, nil)

	uc := &GetMyMatches{Matches: repo}
	if _, err := uc.Do(context.Background(), GetMyMatchesInput{
		UserID: uid, Mode: enums.ArenaModeRanked, Section: enums.SectionGo,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestGetMyMatches_RejectsInvalidMode(t *testing.T) {
	t.Parallel()
	uc := &GetMyMatches{Matches: nil} // repo never reached
	_, err := uc.Do(context.Background(), GetMyMatchesInput{
		UserID: uuid.New(),
		Mode:   enums.ArenaMode("not-a-mode"),
	})
	if err == nil {
		t.Fatalf("expected validation error, got nil")
	}
}

func TestGetMyMatches_RejectsInvalidSection(t *testing.T) {
	t.Parallel()
	uc := &GetMyMatches{Matches: nil}
	_, err := uc.Do(context.Background(), GetMyMatchesInput{
		UserID:  uuid.New(),
		Section: enums.Section("nope"),
	})
	if err == nil {
		t.Fatalf("expected validation error, got nil")
	}
}
