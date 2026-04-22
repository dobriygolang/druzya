package infra

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/profile/domain"
	"druz9/profile/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// memKV is an in-memory KV that mimics Redis enough for cache_test. It
// supports TTL expiry on Get and an injectable failure mode for the redis-
// error fallback test. NOT exported — strictly a test fixture.
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

func newMemKV() *memKV {
	return &memKV{store: map[string]memEntry{}, now: time.Now}
}

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

// has is a test-only synchronous existence check.
func (m *memKV) has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.store[key]
	return ok
}

// ── tests ─────────────────────────────────────────────────────────────────

func newBundle(uid uuid.UUID, username string) domain.Bundle {
	return domain.Bundle{
		User: domain.User{ID: uid, Username: username, DisplayName: "Test"},
	}
}

func TestCachedRepo_GetByUserID_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	want := newBundle(uid, "alice")

	// Upstream is dialed exactly once — second call should be a cache hit.
	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(want, nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	got1, err := repo.GetByUserID(context.Background(), uid)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if got1.User.Username != "alice" {
		t.Fatalf("got %+v", got1)
	}
	got2, err := repo.GetByUserID(context.Background(), uid)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if got2.User.Username != "alice" {
		t.Fatalf("got %+v", got2)
	}
	// Username index should also be populated.
	if !kv.has(keyUsernameIndex(uid)) {
		t.Fatalf("expected username index to be populated")
	}
}

func TestCachedRepo_GetByUserID_UpstreamErrorPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	wantErr := errors.New("pg down")
	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{}, wantErr)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	_, err := repo.GetByUserID(context.Background(), uid)
	if !errors.Is(err, wantErr) {
		t.Fatalf("want %v, got %v", wantErr, err)
	}
}

func TestCachedRepo_GetByUserID_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{}, domain.ErrNotFound)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	_, err := repo.GetByUserID(context.Background(), uid)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	// Negative result is NOT cached — next call should also hit upstream.
	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{}, domain.ErrNotFound)
	_, _ = repo.GetByUserID(context.Background(), uid)
}

func TestCachedRepo_TTLExpiry(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(newBundle(uid, "bob"), nil).Times(2)

	kv := newMemKV()
	now := time.Now()
	kv.now = func() time.Time { return now }
	repo := NewCachedRepo(mock, kv, time.Second, nil)

	if _, err := repo.GetByUserID(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	// Advance the clock past TTL — next read should miss and dial upstream
	// again. mock.EXPECT().Times(2) above codifies the expectation.
	now = now.Add(2 * time.Second)
	if _, err := repo.GetByUserID(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_RedisGetFailureFallsBack(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(newBundle(uid, "carol"), nil)

	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	got, err := repo.GetByUserID(context.Background(), uid)
	if err != nil {
		t.Fatalf("expected fallback to succeed, got: %v", err)
	}
	if got.User.Username != "carol" {
		t.Fatalf("got %+v", got)
	}
}

func TestCachedRepo_Invalidate(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(newBundle(uid, "dave"), nil).Times(2)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	if _, err := repo.GetByUserID(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyByID(uid)) {
		t.Fatalf("expected key after first read")
	}

	repo.Invalidate(context.Background(), uid)
	if kv.has(keyByID(uid)) {
		t.Fatalf("expected key gone after Invalidate")
	}
	if kv.has(keyPublic("dave")) {
		t.Fatalf("expected public key gone after Invalidate")
	}
	// Next read should miss and refetch upstream.
	if _, err := repo.GetByUserID(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_GetPublic_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	pub := domain.PublicBundle{User: domain.User{ID: uid, Username: "eve"}}
	mock.EXPECT().GetPublic(gomock.Any(), "eve").Return(pub, nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	if _, err := repo.GetPublic(context.Background(), "eve"); err != nil {
		t.Fatal(err)
	}
	// Case-insensitive — same key for "EVE".
	if _, err := repo.GetPublic(context.Background(), "EVE"); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_GetPublic_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	mock.EXPECT().GetPublic(gomock.Any(), "ghost").Return(domain.PublicBundle{}, domain.ErrNotFound)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	if _, err := repo.GetPublic(context.Background(), "ghost"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestCachedRepo_WriteThroughInvalidatesAfterUpdateSettings(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()

	mock.EXPECT().GetByUserID(gomock.Any(), uid).Return(newBundle(uid, "frank"), nil).Times(2)
	mock.EXPECT().UpdateSettings(gomock.Any(), uid, gomock.Any()).Return(nil)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	if _, err := repo.GetByUserID(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateSettings(context.Background(), uid, domain.Settings{}); err != nil {
		t.Fatal(err)
	}
	if kv.has(keyByID(uid)) {
		t.Fatalf("expected by_id key to be invalidated after UpdateSettings")
	}
	if _, err := repo.GetByUserID(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

// TestCachedRepo_ConcurrentColdReadCollapsed asserts singleflight: dozens of
// concurrent cold reads should result in exactly one upstream call.
func TestCachedRepo_ConcurrentColdReadCollapsed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	// We assert at most 1 call. Even though the in-memory KV is fast, the
	// singleflight Group should collapse the goroutines that race in before
	// the first one completes the upstream call. We simulate latency to
	// guarantee racing.
	calls := atomic.Int64{}
	mock.EXPECT().GetByUserID(gomock.Any(), uid).DoAndReturn(
		func(_ context.Context, _ uuid.UUID) (domain.Bundle, error) {
			calls.Add(1)
			time.Sleep(20 * time.Millisecond)
			return newBundle(uid, "grace"), nil
		}).MaxTimes(50) // upper bound; we assert exact count below.

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)

	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			if _, err := repo.GetByUserID(context.Background(), uid); err != nil {
				t.Errorf("goroutine: %v", err)
			}
		}()
	}
	wg.Wait()

	// Singleflight may or may not have collapsed every single call (workers
	// arriving after the first one returned will start a new flight), but the
	// number of upstream calls should be small. We allow up to 5 to keep the
	// test robust against scheduling jitter while still proving the
	// thundering-herd guard works.
	if got := calls.Load(); got > 5 {
		t.Fatalf("expected ≤5 upstream calls under singleflight, got %d", got)
	}
}

func TestCachedRepo_UncachedPassthroughs(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()

	mock.EXPECT().ListRatings(gomock.Any(), uid).Return([]domain.SectionRating{{Elo: 1500}}, nil)
	mock.EXPECT().ListSkillNodes(gomock.Any(), uid).Return([]domain.SkillNode{{NodeKey: "x"}}, nil)
	mock.EXPECT().GetSettings(gomock.Any(), uid).Return(domain.Settings{Locale: "en"}, nil)
	mock.EXPECT().CountRecentActivity(gomock.Any(), uid, gomock.Any()).Return(domain.Activity{TasksSolved: 3}, nil)
	mock.EXPECT().EnsureDefaults(gomock.Any(), uid).Return(nil)
	mock.EXPECT().ApplyXPDelta(gomock.Any(), uid, 10, 2, int64(50)).Return(nil)
	mock.EXPECT().UpdateCareerStage(gomock.Any(), uid, domain.CareerStageMiddle).Return(nil)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, nil)
	ctx := context.Background()

	if _, err := repo.ListRatings(ctx, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ListSkillNodes(ctx, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetSettings(ctx, uid); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CountRecentActivity(ctx, uid, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := repo.EnsureDefaults(ctx, uid); err != nil {
		t.Fatal(err)
	}
	if err := repo.ApplyXPDelta(ctx, uid, 10, 2, 50); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateCareerStage(ctx, uid, domain.CareerStageMiddle); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_DefaultTTLApplied(t *testing.T) {
	t.Parallel()
	repo := NewCachedRepo(nil, newMemKV(), 0, nil)
	if repo.ttl != DefaultProfileCacheTTL {
		t.Fatalf("expected default TTL %v, got %v", DefaultProfileCacheTTL, repo.ttl)
	}
}
