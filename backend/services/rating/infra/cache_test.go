// cache_test.go covers the read-through behaviour of CachedRepo against an
// in-memory KV. Mirrors the structure of profile/infra/cache_test.go so a
// reviewer who knows that file can read this one at a glance.
package infra

import (
	"context"
	"errors"
	"io"
	"log/slog"
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

// testLog returns an explicit discard logger for unit tests. Constructors
// now panic on nil log (anti-fallback policy).
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// memKV is a goroutine-safe in-memory KV for tests. Supports TTL and an
// injectable failure mode for the redis-error fallback test.
type memKV struct {
	mu       sync.Mutex
	store    map[string]memEntry
	failGet  bool
	failSet  bool
	failDel  bool
	getCalls atomic.Int64
	setCalls atomic.Int64
	delCalls atomic.Int64
	now      func() time.Time
}

type memEntry struct {
	val       []byte
	expiresAt time.Time
}

func newMemKV() *memKV { return &memKV{store: map[string]memEntry{}, now: time.Now} }

func (m *memKV) Get(_ context.Context, key string) (string, error) {
	m.getCalls.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failGet {
		return "", errors.New("simulated redis failure")
	}
	e, ok := m.store[key]
	if !ok {
		return "", ErrCacheMiss
	}
	if !e.expiresAt.IsZero() && m.now().After(e.expiresAt) {
		delete(m.store, key)
		return "", ErrCacheMiss
	}
	return string(e.val), nil
}

func (m *memKV) Set(_ context.Context, key string, value []byte, ttl time.Duration) error {
	m.setCalls.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failSet {
		return errors.New("simulated redis Set failure")
	}
	e := memEntry{val: append([]byte(nil), value...)}
	if ttl > 0 {
		e.expiresAt = m.now().Add(ttl)
	}
	m.store[key] = e
	return nil
}

func (m *memKV) Del(_ context.Context, keys ...string) error {
	m.delCalls.Add(1)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failDel {
		return errors.New("simulated redis Del failure")
	}
	for _, k := range keys {
		delete(m.store, k)
	}
	return nil
}

func (m *memKV) has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.store[key]
	return ok
}

// putRaw bypasses Set for corruption tests.
func (m *memKV) putRaw(key string, raw []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store[key] = memEntry{val: append([]byte(nil), raw...)}
}

func sampleRatings(uid uuid.UUID) []domain.SectionRating {
	return []domain.SectionRating{
		{UserID: uid, Section: enums.SectionAlgorithms, Elo: 1500, MatchesCount: 10},
		{UserID: uid, Section: enums.SectionSQL, Elo: 1320, MatchesCount: 4},
	}
}

func TestCachedRepo_List_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	want := sampleRatings(uid)
	mock.EXPECT().List(gomock.Any(), uid).Return(want, nil).Times(1)

	repo := NewCachedRepo(mock, newMemKV(), time.Minute, testLog())
	if _, err := repo.List(context.Background(), uid); err != nil {
		t.Fatalf("first call: %v", err)
	}
	got, err := repo.List(context.Background(), uid)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if len(got) != len(want) || got[0].Elo != want[0].Elo {
		t.Fatalf("cache hit mismatch: %+v vs %+v", got, want)
	}
}

func TestCachedRepo_List_TTLExpire(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	want := sampleRatings(uid)
	mock.EXPECT().List(gomock.Any(), uid).Return(want, nil).Times(2)

	now := time.Now()
	kv := newMemKV()
	kv.now = func() time.Time { return now }
	repo := NewCachedRepo(mock, kv, 10*time.Second, testLog())
	if _, err := repo.List(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	now = now.Add(11 * time.Second) // tick past TTL
	if _, err := repo.List(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_List_RedisErrorPropagates(t *testing.T) {
	t.Parallel()
	// fallbacks were removed deliberately — Redis is required, errors propagate.
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	// Upstream MUST NOT be invoked when Redis Get itself fails.

	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedRepo(mock, kv, time.Minute, testLog())
	if _, err := repo.List(context.Background(), uid); err == nil {
		t.Fatalf("expected error when Redis Get fails, got nil")
	}
	_ = ctrl
}

func TestCachedRepo_List_CorruptJSONFallback(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	want := sampleRatings(uid)
	mock.EXPECT().List(gomock.Any(), uid).Return(want, nil).Times(1)

	kv := newMemKV()
	kv.putRaw(keyMy(uid), []byte("not-json{{"))
	repo := NewCachedRepo(mock, kv, time.Minute, testLog())
	got, err := repo.List(context.Background(), uid)
	if err != nil {
		t.Fatalf("expected refresh, got error: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("got %d entries", len(got))
	}
}

func TestCachedRepo_Upsert_InvalidatesUserKey(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	want := sampleRatings(uid)
	mock.EXPECT().List(gomock.Any(), uid).Return(want, nil).Times(2)
	mock.EXPECT().Upsert(gomock.Any(), gomock.Any()).Return(nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, testLog())

	if _, err := repo.List(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyMy(uid)) {
		t.Fatal("expected key cached after first List")
	}
	if err := repo.Upsert(context.Background(), domain.SectionRating{UserID: uid, Section: enums.SectionGo, Elo: 1700}); err != nil {
		t.Fatal(err)
	}
	if kv.has(keyMy(uid)) {
		t.Fatal("expected key invalidated after Upsert")
	}
	// Next List must hit upstream again.
	if _, err := repo.List(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_Invalidate_BustsKey(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().List(gomock.Any(), uid).Return(sampleRatings(uid), nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, testLog())
	if _, err := repo.List(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyMy(uid)) {
		t.Fatal("expected cached")
	}
	repo.Invalidate(context.Background(), uid)
	if kv.has(keyMy(uid)) {
		t.Fatal("expected invalidated")
	}
}

func TestCachedRepo_List_SingleflightCollapsesConcurrentMisses(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().List(gomock.Any(), uid).DoAndReturn(func(_ context.Context, _ uuid.UUID) ([]domain.SectionRating, error) {
		time.Sleep(20 * time.Millisecond)
		return sampleRatings(uid), nil
	}).Times(1)

	repo := NewCachedRepo(mock, newMemKV(), time.Minute, testLog())

	const N = 8
	var wg sync.WaitGroup
	wg.Add(N)
	errs := make(chan error, N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			if _, err := repo.List(context.Background(), uid); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Fatalf("concurrent List error: %v", e)
	}
}

func TestCachedRepo_List_DelegateError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().List(gomock.Any(), uid).Return(nil, errors.New("pg down")).Times(1)
	repo := NewCachedRepo(mock, newMemKV(), time.Minute, testLog())
	if _, err := repo.List(context.Background(), uid); err == nil {
		t.Fatal("expected error")
	}
}

func TestCachedRepo_PassThrough_TopFindRankHistory(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Top(gomock.Any(), enums.SectionAlgorithms, 10).Return([]domain.LeaderboardEntry{{UserID: uid, Elo: 1500}}, nil)
	mock.EXPECT().FindRank(gomock.Any(), uid, enums.SectionAlgorithms).Return(7, nil)
	mock.EXPECT().HistoryLast12Weeks(gomock.Any(), uid).Return([]domain.HistorySample{}, nil)

	repo := NewCachedRepo(mock, newMemKV(), time.Minute, testLog())
	if _, err := repo.Top(context.Background(), enums.SectionAlgorithms, 10); err != nil {
		t.Fatal(err)
	}
	if r, _ := repo.FindRank(context.Background(), uid, enums.SectionAlgorithms); r != 7 {
		t.Fatalf("rank=%d", r)
	}
	if _, err := repo.HistoryLast12Weeks(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_DefaultTTLApplied(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockRatingRepo(ctrl)
	repo := NewCachedRepo(mock, newMemKV(), 0, testLog())
	if repo.ttl != DefaultMyRatingsTTL {
		t.Fatalf("default TTL not applied: %s", repo.ttl)
	}
}

func TestCachedRepo_NewRedisKVDelEmpty(t *testing.T) {
	t.Parallel()
	// redisKV.Del with no keys MUST be a no-op (avoid sending DEL with no
	// args which Redis rejects).
	kv := redisKV{} // nil rdb is OK because we won't call into it.
	if err := kv.Del(context.Background()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}
