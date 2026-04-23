package infra

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/guild/domain"
	"druz9/guild/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// memKV is an in-memory KV that mimics Redis enough for the cache tests.
// Mirrors the shape used in profile/infra/cache_test.go and
// rating/infra/cache_test.go so future readers find familiar terrain.
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

// has is a synchronous existence check used by the tests.
func (m *memKV) has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.store[key]
	return ok
}

// raw returns the stored value for a key (no TTL check). Used by tests
// that want to inject corrupt JSON manually.
func (m *memKV) putRaw(key string, value []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store[key] = memEntry{val: append([]byte(nil), value...)}
}

// ── fixtures ──────────────────────────────────────────────────────────────

func mkGuild(name string) domain.Guild {
	return domain.Guild{
		ID:       uuid.New(),
		OwnerID:  uuid.New(),
		Name:     name,
		Emblem:   "shield",
		GuildElo: 1234,
	}
}

func mkTop(n int) []domain.TopGuildSummary {
	out := make([]domain.TopGuildSummary, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, domain.TopGuildSummary{
			GuildID:      uuid.New(),
			Name:         "g" + string(rune('a'+i)),
			MembersCount: 5,
			EloTotal:     2000 - i,
			Rank:         i + 1,
		})
	}
	return out
}

// ── tests: GetGuild ───────────────────────────────────────────────────────

func TestCachedRepo_GetGuild_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	want := mkGuild("ironclad")
	// Upstream is dialled exactly once — second read should be a hit.
	mock.EXPECT().GetGuild(gomock.Any(), want.ID).Return(want, nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	got1, err := repo.GetGuild(context.Background(), want.ID)
	if err != nil || got1.Name != "ironclad" {
		t.Fatalf("first call: got=%+v err=%v", got1, err)
	}
	got2, err := repo.GetGuild(context.Background(), want.ID)
	if err != nil || got2.Name != "ironclad" {
		t.Fatalf("second call: got=%+v err=%v", got2, err)
	}
}

func TestCachedRepo_GetGuild_TTLExpiry(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	g := mkGuild("nightfall")
	mock.EXPECT().GetGuild(gomock.Any(), g.ID).Return(g, nil).Times(2)

	kv := newMemKV()
	now := time.Now()
	kv.now = func() time.Time { return now }
	repo := NewCachedRepo(mock, kv, time.Second, 5*time.Minute, nil)

	if _, err := repo.GetGuild(context.Background(), g.ID); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Second)
	if _, err := repo.GetGuild(context.Background(), g.ID); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_GetGuild_RedisGetFailureFallsBack(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	g := mkGuild("phoenix")
	mock.EXPECT().GetGuild(gomock.Any(), g.ID).Return(g, nil)

	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	got, err := repo.GetGuild(context.Background(), g.ID)
	if err != nil || got.Name != "phoenix" {
		t.Fatalf("expected fallback to succeed: got=%+v err=%v", got, err)
	}
}

func TestCachedRepo_GetGuild_CorruptJSONFallsBack(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	g := mkGuild("garbage")
	// Upstream is dialled exactly once because the corrupt entry is
	// overwritten on miss-handler success.
	mock.EXPECT().GetGuild(gomock.Any(), g.ID).Return(g, nil).Times(1)

	kv := newMemKV()
	kv.putRaw(keyByID(g.ID), []byte("not valid json"))
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	got, err := repo.GetGuild(context.Background(), g.ID)
	if err != nil || got.Name != "garbage" {
		t.Fatalf("expected upstream after corrupt entry: got=%+v err=%v", got, err)
	}
}

func TestCachedRepo_GetGuild_UpstreamErrorPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	id := uuid.New()
	wantErr := errors.New("pg down")
	mock.EXPECT().GetGuild(gomock.Any(), id).Return(domain.Guild{}, wantErr)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if _, err := repo.GetGuild(context.Background(), id); !errors.Is(err, wantErr) {
		t.Fatalf("want %v, got %v", wantErr, err)
	}
}

func TestCachedRepo_Invalidate(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	g := mkGuild("warcry")
	mock.EXPECT().GetGuild(gomock.Any(), g.ID).Return(g, nil).Times(2)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if _, err := repo.GetGuild(context.Background(), g.ID); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyByID(g.ID)) {
		t.Fatal("expected cache entry")
	}
	repo.Invalidate(context.Background(), g.ID)
	if kv.has(keyByID(g.ID)) {
		t.Fatal("expected entry to be gone after Invalidate")
	}
	if _, err := repo.GetGuild(context.Background(), g.ID); err != nil {
		t.Fatal(err)
	}
}

// ── tests: GetMyGuild ─────────────────────────────────────────────────────

func TestCachedRepo_GetMyGuild_MissThenHitMaintainsIndex(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	uid := uuid.New()
	g := mkGuild("clan")
	mock.EXPECT().GetMyGuild(gomock.Any(), uid).Return(g, nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if _, err := repo.GetMyGuild(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.GetMyGuild(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyUserToGuild(uid)) {
		t.Fatal("expected reverse index to be populated")
	}
}

func TestCachedRepo_GetMyGuild_NotFoundNotCached(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	uid := uuid.New()
	// Upstream is hit twice — negative results MUST NOT be cached.
	mock.EXPECT().GetMyGuild(gomock.Any(), uid).Return(domain.Guild{}, domain.ErrNotFound).Times(2)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if _, err := repo.GetMyGuild(context.Background(), uid); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if _, err := repo.GetMyGuild(context.Background(), uid); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestCachedRepo_InvalidateUser(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	uid := uuid.New()
	g := mkGuild("brotherhood")
	mock.EXPECT().GetMyGuild(gomock.Any(), uid).Return(g, nil).Times(2)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if _, err := repo.GetMyGuild(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyMyByUser(uid)) || !kv.has(keyUserToGuild(uid)) {
		t.Fatal("expected per-user keys after first read")
	}
	repo.InvalidateUser(context.Background(), uid)
	if kv.has(keyMyByUser(uid)) || kv.has(keyUserToGuild(uid)) {
		t.Fatal("expected per-user keys gone after InvalidateUser")
	}
	if _, err := repo.GetMyGuild(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

// ── tests: ListTopGuilds ──────────────────────────────────────────────────

func TestCachedRepo_ListTopGuilds_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	want := mkTop(3)
	mock.EXPECT().ListTopGuilds(gomock.Any(), 20).Return(want, nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	got1, err := repo.ListTopGuilds(context.Background(), 20)
	if err != nil || len(got1) != 3 {
		t.Fatalf("first call: got=%v err=%v", got1, err)
	}
	got2, err := repo.ListTopGuilds(context.Background(), 20)
	if err != nil || len(got2) != 3 {
		t.Fatalf("second call: got=%v err=%v", got2, err)
	}
}

func TestCachedRepo_ListTopGuilds_DifferentLimitsAreSeparateKeys(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	mock.EXPECT().ListTopGuilds(gomock.Any(), 10).Return(mkTop(10), nil).Times(1)
	mock.EXPECT().ListTopGuilds(gomock.Any(), 50).Return(mkTop(50), nil).Times(1)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if got, err := repo.ListTopGuilds(context.Background(), 10); err != nil || len(got) != 10 {
		t.Fatalf("limit=10: got=%d err=%v", len(got), err)
	}
	if got, err := repo.ListTopGuilds(context.Background(), 50); err != nil || len(got) != 50 {
		t.Fatalf("limit=50: got=%d err=%v", len(got), err)
	}
	// Reads against the same limits must hit the cache.
	if _, err := repo.ListTopGuilds(context.Background(), 10); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ListTopGuilds(context.Background(), 50); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_InvalidateTop(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	mock.EXPECT().ListTopGuilds(gomock.Any(), 20).Return(mkTop(2), nil).Times(2)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if _, err := repo.ListTopGuilds(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyTop(20)) {
		t.Fatal("expected top key cached")
	}
	repo.InvalidateTop(context.Background())
	if kv.has(keyTop(20)) {
		t.Fatal("expected top key gone after InvalidateTop")
	}
	if _, err := repo.ListTopGuilds(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
}

// ── tests: misc ───────────────────────────────────────────────────────────

func TestCachedRepo_DefaultTTLApplied(t *testing.T) {
	t.Parallel()
	repo := NewCachedRepo(nil, newMemKV(), 0, 0, nil)
	if repo.ttl != DefaultGuildCacheTTL {
		t.Fatalf("expected default per-guild TTL, got %v", repo.ttl)
	}
	if repo.topTTL != DefaultTopGuildsCacheTTL {
		t.Fatalf("expected default top TTL, got %v", repo.topTTL)
	}
}

func TestCachedRepo_PassthroughMembers(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	gid := uuid.New()
	uid := uuid.New()
	mock.EXPECT().ListGuildMembers(gomock.Any(), gid).Return([]domain.Member{{UserID: uid}}, nil)
	mock.EXPECT().GetMember(gomock.Any(), gid, uid).Return(domain.Member{UserID: uid}, nil)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)
	if out, err := repo.ListGuildMembers(context.Background(), gid); err != nil || len(out) != 1 {
		t.Fatalf("members: %v %v", out, err)
	}
	if _, err := repo.GetMember(context.Background(), gid, uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedRepo_UpsertGuildBustsCaches(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	g := mkGuild("forge")
	mock.EXPECT().GetGuild(gomock.Any(), g.ID).Return(g, nil)
	mock.EXPECT().UpsertGuild(gomock.Any(), gomock.Any()).Return(g, nil)
	mock.EXPECT().ListTopGuilds(gomock.Any(), 20).Return(mkTop(2), nil)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	if _, err := repo.GetGuild(context.Background(), g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ListTopGuilds(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyByID(g.ID)) || !kv.has(keyTop(20)) {
		t.Fatal("expected both caches populated before UpsertGuild")
	}
	if _, err := repo.UpsertGuild(context.Background(), g); err != nil {
		t.Fatal(err)
	}
	if kv.has(keyByID(g.ID)) {
		t.Fatal("expected by_id key gone after UpsertGuild")
	}
	if kv.has(keyTop(20)) {
		t.Fatal("expected top key gone after UpsertGuild")
	}
}

// TestCachedRepo_ConcurrentColdReadCollapsed asserts singleflight: dozens
// of concurrent cold reads should result in a small number of upstream
// calls, not N. We allow up to 5 to keep the assertion robust against
// scheduling jitter (same shape as profile/cache_test.go).
func TestCachedRepo_ConcurrentColdReadCollapsed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	g := mkGuild("flock")
	calls := atomic.Int64{}
	mock.EXPECT().GetGuild(gomock.Any(), g.ID).DoAndReturn(
		func(_ context.Context, _ uuid.UUID) (domain.Guild, error) {
			calls.Add(1)
			time.Sleep(20 * time.Millisecond)
			return g, nil
		}).MaxTimes(50)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			if _, err := repo.GetGuild(context.Background(), g.ID); err != nil {
				t.Errorf("goroutine: %v", err)
			}
		}()
	}
	wg.Wait()
	if got := calls.Load(); got > 5 {
		t.Fatalf("expected ≤5 upstream calls under singleflight, got %d", got)
	}
}

func TestCachedRepo_InvalidateMatchParticipants(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockGuildRepo(ctrl)
	uid := uuid.New()
	g := mkGuild("avengers")
	mock.EXPECT().GetMyGuild(gomock.Any(), uid).Return(g, nil)

	kv := newMemKV()
	repo := NewCachedRepo(mock, kv, time.Minute, 5*time.Minute, nil)

	// Prime the per-user and per-guild keys.
	if _, err := repo.GetMyGuild(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	// Also prime a top-list entry to verify the side-effect.
	kv.putRaw(keyTop(20), []byte("[]"))

	repo.InvalidateMatchParticipants(context.Background(), uid)

	if kv.has(keyMyByUser(uid)) {
		t.Fatal("expected per-user key gone")
	}
	if kv.has(keyTop(20)) {
		t.Fatal("expected top-list key gone")
	}
}
