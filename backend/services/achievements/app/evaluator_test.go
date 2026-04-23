package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"druz9/achievements/domain"

	"github.com/google/uuid"
)

type stubRepo struct {
	mu       sync.Mutex
	upserted map[string]int
	target   map[string]int
}

func newStub() *stubRepo {
	return &stubRepo{upserted: map[string]int{}, target: map[string]int{}}
}

func (s *stubRepo) Get(_ context.Context, _ uuid.UUID, _ string) (domain.UserAchievement, error) {
	return domain.UserAchievement{}, domain.ErrNotFound
}
func (s *stubRepo) List(_ context.Context, _ uuid.UUID) ([]domain.UserAchievement, error) {
	return nil, nil
}
func (s *stubRepo) UpsertProgress(_ context.Context, uid uuid.UUID, code string, progress, target int) (domain.UserAchievement, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev, had := s.upserted[code]
	s.upserted[code] = progress
	if target > s.target[code] {
		s.target[code] = target
	}
	unlocked := false
	t := s.target[code]
	if progress >= t && !(had && prev >= t) {
		unlocked = true
	}
	row := domain.UserAchievement{UserID: uid, Code: code, Progress: progress, Target: t}
	if unlocked {
		now := time.Now()
		row.UnlockedAt = &now
	}
	return row, unlocked, nil
}
func (s *stubRepo) Unlock(ctx context.Context, uid uuid.UUID, code string, target int) (domain.UserAchievement, bool, error) {
	return s.UpsertProgress(ctx, uid, code, target, target)
}

type stubProvider struct{ st UserState }

func (s stubProvider) Snapshot(_ context.Context, _ uuid.UUID) (UserState, error) {
	return s.st, nil
}

func TestEvaluator_UnlocksFirstBlood(t *testing.T) {
	repo := newStub()
	ev := &Evaluator{Repo: repo, State: stubProvider{st: UserState{ArenaWins: 1, FriendsCount: 1}}}
	got, err := ev.EvaluateUserProgress(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("eval: %v", err)
	}
	want := map[string]bool{"first-blood": true, "first-friend": true}
	for _, c := range got {
		if !want[c] {
			delete(want, c)
		} else {
			delete(want, c)
		}
	}
	if len(want) > 0 {
		t.Fatalf("did not unlock all expected: %v (got: %v)", want, got)
	}
}

func TestEvaluator_NilRepoReturnsError(t *testing.T) {
	ev := &Evaluator{}
	if _, err := ev.EvaluateUserProgress(context.Background(), uuid.New()); err == nil {
		t.Fatal("expected error for nil repo")
	}
}

type errProvider struct{}

func (errProvider) Snapshot(_ context.Context, _ uuid.UUID) (UserState, error) {
	return UserState{}, errors.New("boom")
}

func TestEvaluator_PropagatesProviderErr(t *testing.T) {
	ev := &Evaluator{Repo: newStub(), State: errProvider{}}
	if _, err := ev.EvaluateUserProgress(context.Background(), uuid.New()); err == nil {
		t.Fatal("expected provider error to propagate")
	}
}

func TestScoreForCode_SamplesAllArms(t *testing.T) {
	st := UserState{
		XPTotal:          12345,
		Level:            12,
		AtlasPercent:     30,
		ArenaWins:        15,
		MaxELO:           2500,
		CurrentWinStreak: 3,
		DailyTotalDone:   5,
		CurrentStreak:    8,
		FriendsCount:     6,
		GuildJoined:      true,
		GuildWarsWon:     1,
		AnySolved:        50,
		HardSolved:       3,
		ChallengesSent:   4,
	}
	if got := scoreForCode("first-blood", st); got != 1 {
		t.Fatalf("first-blood: %d", got)
	}
	if got := scoreForCode("streak-7", st); got != 7 {
		t.Fatalf("streak-7 clamped: %d", got)
	}
	if got := scoreForCode("ranked-promotion-platinum", st); got != 1 {
		t.Fatalf("plat promo: %d", got)
	}
	if got := scoreForCode("guild-joined", st); got != 1 {
		t.Fatalf("guild-joined: %d", got)
	}
	if got := scoreForCode("speed-demon", st); got != -1 {
		t.Fatalf("speed-demon should be no-data: %d", got)
	}
}

func TestListAchievements_MergesCatalogueAndState(t *testing.T) {
	uc := &ListAchievements{Repo: newStub()}
	out, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	cat := domain.Catalogue()
	if len(out) != len(cat) {
		t.Fatalf("expected %d items, got %d", len(cat), len(out))
	}
	// все элементы должны иметь target>0 (catalogue гарантирует).
	for _, it := range out {
		if it.Target < 1 {
			t.Fatalf("item %s has zero target", it.Code)
		}
	}
}
