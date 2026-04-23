package infra

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/rating/domain"
	"druz9/rating/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// fakeZSet is an in-memory LeaderboardZSetClient with optional failure
// injection so we can exercise the worker's resilience paths.
type fakeZSet struct {
	mu       sync.Mutex
	zsets    map[string][]ZMember
	meta     map[string]string
	delCalls atomic.Int64
	addCalls atomic.Int64
	setCalls atomic.Int64
	failDel  bool
	failZAdd bool
	failSet  bool
}

func newFakeZSet() *fakeZSet {
	return &fakeZSet{zsets: map[string][]ZMember{}, meta: map[string]string{}}
}

func (f *fakeZSet) Del(_ context.Context, keys ...string) error {
	f.delCalls.Add(1)
	if f.failDel {
		return errors.New("simulated DEL failure")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, k := range keys {
		delete(f.zsets, k)
	}
	return nil
}

func (f *fakeZSet) ZAdd(_ context.Context, key string, members ...ZMember) error {
	f.addCalls.Add(1)
	if f.failZAdd {
		return errors.New("simulated ZADD failure")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.zsets[key] = append(f.zsets[key], members...)
	return nil
}

func (f *fakeZSet) Set(_ context.Context, key, value string, _ time.Duration) error {
	f.setCalls.Add(1)
	if f.failSet {
		return errors.New("simulated SET failure")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.meta[key] = value
	return nil
}

func (f *fakeZSet) snapshot() (map[string][]ZMember, map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	z := make(map[string][]ZMember, len(f.zsets))
	for k, v := range f.zsets {
		z[k] = append([]ZMember(nil), v...)
	}
	m := make(map[string]string, len(f.meta))
	for k, v := range f.meta {
		m[k] = v
	}
	return z, m
}

func twoEntries() []domain.LeaderboardEntry {
	return []domain.LeaderboardEntry{
		{UserID: uuid.New(), Username: "alice", Elo: 1700, Rank: 1},
		{UserID: uuid.New(), Username: "bob", Elo: 1500, Rank: 2},
	}
}

func TestWorker_RecomputeOne_PopulatesZSet(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	mock.EXPECT().Top(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).Return(twoEntries(), nil)

	z := newFakeZSet()
	w := NewLeaderboardRecomputeWorker(mock, z, testLog(), time.Hour, 100)
	if err := w.recomputeOne(context.Background(), enums.SectionAlgorithms); err != nil {
		t.Fatal(err)
	}
	zs, meta := z.snapshot()
	key := LeaderboardZSetKey(enums.SectionAlgorithms, "all")
	if got := zs[key]; len(got) != 2 || got[0].Score != 1700 {
		t.Fatalf("zset: %+v", got)
	}
	if meta[LeaderboardMetaKey(enums.SectionAlgorithms, "all")] == "" {
		t.Fatal("expected meta timestamp written")
	}
}

func TestWorker_RecomputeOne_EmptySectionStillSetsMeta(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	mock.EXPECT().Top(gomock.Any(), enums.SectionSQL, gomock.Any()).Return([]domain.LeaderboardEntry{}, nil)

	z := newFakeZSet()
	w := NewLeaderboardRecomputeWorker(mock, z, testLog(), time.Hour, 100)
	if err := w.recomputeOne(context.Background(), enums.SectionSQL); err != nil {
		t.Fatal(err)
	}
	_, meta := z.snapshot()
	if meta[LeaderboardMetaKey(enums.SectionSQL, "all")] == "" {
		t.Fatal("expected meta timestamp even for empty section")
	}
	if z.addCalls.Load() != 0 {
		t.Fatal("expected no ZADD on empty section")
	}
}

func TestWorker_RecomputeOne_RepoErrorPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	mock.EXPECT().Top(gomock.Any(), enums.SectionGo, gomock.Any()).Return(nil, errors.New("pg down"))
	z := newFakeZSet()
	w := NewLeaderboardRecomputeWorker(mock, z, testLog(), time.Hour, 100)
	if err := w.recomputeOne(context.Background(), enums.SectionGo); err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestWorker_RecomputeOne_DelErrorPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	mock.EXPECT().Top(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).Return(twoEntries(), nil)
	z := newFakeZSet()
	z.failDel = true
	w := NewLeaderboardRecomputeWorker(mock, z, testLog(), time.Hour, 100)
	if err := w.recomputeOne(context.Background(), enums.SectionAlgorithms); err == nil {
		t.Fatal("expected error from DEL failure")
	}
}

func TestWorker_RecomputeAll_OneSectionFails_OthersSucceed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	// First call (algorithms) errors; remaining sections succeed empty.
	first := true
	mock.EXPECT().Top(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ enums.Section, _ int) ([]domain.LeaderboardEntry, error) {
			if first {
				first = false
				return nil, errors.New("boom")
			}
			return []domain.LeaderboardEntry{}, nil
		}).AnyTimes()

	z := newFakeZSet()
	w := NewLeaderboardRecomputeWorker(mock, z, testLog(), time.Hour, 100)
	w.recomputeAll(context.Background())
	_, meta := z.snapshot()
	// Every section that succeeded should have written meta.
	if len(meta) == 0 {
		t.Fatal("expected at least one successful section meta")
	}
}

func TestWorker_Run_GracefulShutdown(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	mock.EXPECT().Top(gomock.Any(), gomock.Any(), gomock.Any()).Return([]domain.LeaderboardEntry{}, nil).AnyTimes()

	z := newFakeZSet()
	w := NewLeaderboardRecomputeWorker(mock, z, testLog(), 10*time.Millisecond, 100)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		w.Run(ctx)
		close(done)
	}()

	// Let at least one tick pass.
	time.Sleep(40 * time.Millisecond)
	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("worker did not shut down")
	}
	if w.Ticks() < 1 {
		t.Fatalf("expected at least one tick, got %d", w.Ticks())
	}
}

func TestWorker_Run_TicksPeriodically(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	mock.EXPECT().Top(gomock.Any(), gomock.Any(), gomock.Any()).Return([]domain.LeaderboardEntry{}, nil).AnyTimes()
	z := newFakeZSet()
	w := NewLeaderboardRecomputeWorker(mock, z, testLog(), 5*time.Millisecond, 100)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	w.Run(ctx)
	if w.Ticks() < 2 {
		t.Fatalf("expected ≥2 ticks, got %d", w.Ticks())
	}
}

func TestWorker_DefaultsApplied(t *testing.T) {
	t.Parallel()
	w := NewLeaderboardRecomputeWorker(nil, newFakeZSet(), testLog(), 0, 0)
	if w.interval != DefaultRecomputeInterval || w.limit != DefaultRecomputeLimit {
		t.Fatalf("defaults not applied: interval=%s limit=%d", w.interval, w.limit)
	}
}

func TestLeaderboardZSetKey(t *testing.T) {
	t.Parallel()
	if got := LeaderboardZSetKey(enums.SectionAlgorithms, ""); got != "leaderboard:v1:algorithms:all" {
		t.Fatalf("unexpected key: %s", got)
	}
	if got := LeaderboardZSetKey(enums.SectionSQL, "ranked"); got != "leaderboard:v1:sql:ranked" {
		t.Fatalf("unexpected key: %s", got)
	}
}

func TestLeaderboardMetaKey(t *testing.T) {
	t.Parallel()
	if got := LeaderboardMetaKey(enums.SectionGo, ""); got != "leaderboard:v1:meta:go:all" {
		t.Fatalf("unexpected key: %s", got)
	}
}

func TestRedisZSetAdapter_DelEmptyIsNoop(t *testing.T) {
	t.Parallel()
	a := redisZSetAdapter{} // nil rdb is OK because empty keys short-circuits
	if err := a.Del(context.Background()); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestRedisZSetAdapter_ZAddEmptyIsNoop(t *testing.T) {
	t.Parallel()
	a := redisZSetAdapter{} // nil rdb OK because empty members short-circuits
	if err := a.ZAdd(context.Background(), "k"); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}
