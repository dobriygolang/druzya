package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"druz9/intelligence/domain"
	mocks "druz9/intelligence/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// primaryGoalStore — закрытая state-машина для PrimaryGoalRepo.
// Mirror DB partial unique index: Insert деактивирует предыдущую активную
// запись для (user_id, active=true).
type primaryGoalStore struct {
	mu   sync.Mutex
	rows []domain.PrimaryGoal
}

func wireMockPrimaryGoalRepo(ctrl *gomock.Controller, s *primaryGoalStore) *mocks.MockPrimaryGoalRepo {
	m := mocks.NewMockPrimaryGoalRepo(ctrl)
	m.EXPECT().Insert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.PrimaryGoal) (domain.PrimaryGoal, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			for i := range s.rows {
				if s.rows[i].UserID == in.UserID && s.rows[i].Active {
					s.rows[i].Active = false
				}
			}
			in.ID = uuid.New()
			s.rows = append(s.rows, in)
			return in, nil
		},
	).AnyTimes()
	m.EXPECT().GetActive(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (domain.PrimaryGoal, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			for _, row := range s.rows {
				if row.UserID == userID && row.Active {
					return row, nil
				}
			}
			return domain.PrimaryGoal{}, domain.ErrNotFound
		},
	).AnyTimes()
	m.EXPECT().UpdateByID(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.PrimaryGoal) (domain.PrimaryGoal, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			for i := range s.rows {
				if s.rows[i].ID == in.ID && s.rows[i].UserID == in.UserID {
					s.rows[i].Kind = in.Kind
					s.rows[i].TargetCompany = in.TargetCompany
					s.rows[i].TargetLevel = in.TargetLevel
					s.rows[i].TargetText = in.TargetText
					s.rows[i].TargetDate = in.TargetDate
					s.rows[i].UpdatedAt = in.UpdatedAt
					return s.rows[i], nil
				}
			}
			return domain.PrimaryGoal{}, domain.ErrNotFound
		},
	).AnyTimes()
	m.EXPECT().DeactivateByID(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID, goalID uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			for i := range s.rows {
				if s.rows[i].ID == goalID && s.rows[i].UserID == userID && s.rows[i].Active {
					s.rows[i].Active = false
					return nil
				}
			}
			return domain.ErrNotFound
		},
	).AnyTimes()
	return m
}

// ─── CreateGoal ───────────────────────────────────────────────────────────

func TestCreateGoal_HappyPath(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	repo := wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})
	uc := CreateGoal{Repo: repo, Now: func() time.Time { return time.Date(2026, 5, 12, 0, 0, 0, 0, time.UTC) }}

	cases := []struct {
		name string
		in   CreateGoalInput
	}{
		{
			"top_tier_co with company + date",
			CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindTopTierCo, TargetCompany: "Yandex", TargetDate: "2026-11-01"},
		},
		{
			"any_senior bare",
			CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindAnySenior},
		},
		{
			"ml_offer bare",
			CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindMLOffer},
		},
		{
			"english_target with text",
			CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindEnglishTarget, TargetText: "TOEFL 100+"},
		},
		{
			"custom with text",
			CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindCustom, TargetText: "Ship side-project"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := uc.Do(context.Background(), tc.in)
			if err != nil {
				t.Fatalf("unexpected: %v", err)
			}
			if !out.Active {
				t.Fatal("created goal must be active")
			}
			if out.ID == uuid.Nil {
				t.Fatal("created goal must have id")
			}
			if out.Kind != tc.in.Kind {
				t.Fatalf("kind mismatch: want %q got %q", tc.in.Kind, out.Kind)
			}
		})
	}
}

func TestCreateGoal_DeactivatesPriorActive(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	store := &primaryGoalStore{}
	repo := wireMockPrimaryGoalRepo(ctrl, store)
	uc := CreateGoal{Repo: repo}

	_, err := uc.Do(context.Background(), CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindAnySenior})
	if err != nil {
		t.Fatal(err)
	}
	_, err = uc.Do(context.Background(), CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindMLOffer})
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	activeCount := 0
	for _, r := range store.rows {
		if r.Active {
			activeCount++
		}
	}
	store.mu.Unlock()
	if activeCount != 1 {
		t.Fatalf("expected exactly one active, got %d", activeCount)
	}
}

func TestCreateGoal_ValidationErrors(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := CreateGoal{Repo: wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})}
	cases := []struct {
		name string
		in   CreateGoalInput
	}{
		{"zero user_id", CreateGoalInput{Kind: domain.PrimaryGoalKindAnySenior}},
		{"invalid kind", CreateGoalInput{UserID: uuid.New(), Kind: "leetcode_grind"}},
		{"top_tier_co without company", CreateGoalInput{UserID: uuid.New(), Kind: domain.PrimaryGoalKindTopTierCo}},
		{"custom without text", CreateGoalInput{UserID: uuid.New(), Kind: domain.PrimaryGoalKindCustom}},
		{"bad date", CreateGoalInput{UserID: uuid.New(), Kind: domain.PrimaryGoalKindAnySenior, TargetDate: "2026/11/01"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := uc.Do(context.Background(), tc.in)
			if err == nil || !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

// ─── GetActiveGoal ────────────────────────────────────────────────────────

func TestGetActiveGoal_NotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := GetActiveGoal{Repo: wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})}
	_, err := uc.Do(context.Background(), uuid.New())
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestGetActiveGoal_HappyPath(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	repo := wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})
	createUC := CreateGoal{Repo: repo}
	if _, err := createUC.Do(context.Background(), CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindAnySenior}); err != nil {
		t.Fatal(err)
	}
	uc := GetActiveGoal{Repo: repo}
	got, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != domain.PrimaryGoalKindAnySenior || !got.Active {
		t.Fatalf("unexpected goal: %+v", got)
	}
}

// ─── UpdateGoal ───────────────────────────────────────────────────────────

func TestUpdateGoal_HappyPath(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	repo := wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})
	create := CreateGoal{Repo: repo}
	created, err := create.Do(context.Background(), CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindAnySenior})
	if err != nil {
		t.Fatal(err)
	}
	update := UpdateGoal{Repo: repo}
	out, err := update.Do(context.Background(), UpdateGoalInput{
		UserID: uid, GoalID: created.ID,
		Kind: domain.PrimaryGoalKindTopTierCo, TargetCompany: "Google", TargetDate: "2027-01-15",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Kind != domain.PrimaryGoalKindTopTierCo || out.TargetCompany != "Google" {
		t.Fatalf("update did not apply: %+v", out)
	}
}

func TestUpdateGoal_NotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := UpdateGoal{Repo: wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})}
	_, err := uc.Do(context.Background(), UpdateGoalInput{
		UserID: uuid.New(), GoalID: uuid.New(), Kind: domain.PrimaryGoalKindAnySenior,
	})
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestUpdateGoal_ValidationErrors(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := UpdateGoal{Repo: wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})}
	cases := []struct {
		name string
		in   UpdateGoalInput
	}{
		{"zero user_id", UpdateGoalInput{GoalID: uuid.New(), Kind: domain.PrimaryGoalKindAnySenior}},
		{"zero goal_id", UpdateGoalInput{UserID: uuid.New(), Kind: domain.PrimaryGoalKindAnySenior}},
		{"invalid kind", UpdateGoalInput{UserID: uuid.New(), GoalID: uuid.New(), Kind: "nonsense"}},
		{"top_tier_co missing company", UpdateGoalInput{UserID: uuid.New(), GoalID: uuid.New(), Kind: domain.PrimaryGoalKindTopTierCo}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := uc.Do(context.Background(), tc.in)
			if err == nil || !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

// ─── DeactivateGoal ───────────────────────────────────────────────────────

func TestDeactivateGoal_HappyPath(t *testing.T) {
	uid := uuid.New()
	ctrl := gomock.NewController(t)
	repo := wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})
	create := CreateGoal{Repo: repo}
	g, err := create.Do(context.Background(), CreateGoalInput{UserID: uid, Kind: domain.PrimaryGoalKindAnySenior})
	if err != nil {
		t.Fatal(err)
	}
	uc := DeactivateGoal{Repo: repo}
	if err := uc.Do(context.Background(), uid, g.ID); err != nil {
		t.Fatal(err)
	}
	get := GetActiveGoal{Repo: repo}
	if _, err := get.Do(context.Background(), uid); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected goal to be deactivated, got err=%v", err)
	}
}

func TestDeactivateGoal_NotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := DeactivateGoal{Repo: wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})}
	err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeactivateGoal_ValidationErrors(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := DeactivateGoal{Repo: wireMockPrimaryGoalRepo(ctrl, &primaryGoalStore{})}
	if err := uc.Do(context.Background(), uuid.Nil, uuid.New()); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if err := uc.Do(context.Background(), uuid.New(), uuid.Nil); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
