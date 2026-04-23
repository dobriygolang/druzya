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

	"druz9/ai_mock/domain"
	"druz9/ai_mock/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// testLog returns an io.Discard-backed logger acceptable to constructors
// that demand non-nil *slog.Logger (anti-fallback policy).
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// memKV is the in-memory KV used by every cache test. It mirrors the one in
// profile/infra/cache_test so the test surface stays familiar; not exported
// because no production code should depend on it.
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

func (m *memKV) has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.store[key]
	return ok
}

// ── fixtures ──────────────────────────────────────────────────────────────

func sampleSession(uid, sid uuid.UUID) domain.Session {
	return domain.Session{
		ID:          sid,
		UserID:      uid,
		CompanyID:   uuid.New(),
		TaskID:      uuid.New(),
		Section:     enums.SectionAlgorithms,
		Difficulty:  enums.DifficultyMedium,
		Status:      enums.MockStatusInProgress,
		DurationMin: 45,
		LLMModel:    enums.LLMModelGPT4oMini,
	}
}

// ── session cache tests ───────────────────────────────────────────────────

func TestCachedSessionRepo_GetMissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// Upstream is dialled exactly once; the second Get should be a cache hit.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).Times(1)

	kv := newMemKV()
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())

	got1, err := repo.Get(context.Background(), sid)
	if err != nil {
		t.Fatalf("first Get: %v", err)
	}
	if got1.ID != sid {
		t.Fatalf("first Get returned wrong id: %v", got1.ID)
	}
	got2, err := repo.Get(context.Background(), sid)
	if err != nil {
		t.Fatalf("second Get: %v", err)
	}
	if got2.ID != sid {
		t.Fatalf("second Get returned wrong id: %v", got2.ID)
	}
}

func TestCachedSessionRepo_TTLExpire(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// Two upstream hits — first populates, second after expiry refreshes.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).Times(2)

	now := time.Unix(1_700_000_000, 0)
	kv := newMemKV()
	kv.now = func() time.Time { return now }
	repo := NewCachedSessionRepo(mock, kv, 30*time.Second, testLog())

	if _, err := repo.Get(context.Background(), sid); err != nil {
		t.Fatalf("Get warm: %v", err)
	}
	now = now.Add(31 * time.Second) // jump past TTL
	if _, err := repo.Get(context.Background(), sid); err != nil {
		t.Fatalf("Get after expiry: %v", err)
	}
}

func TestCachedSessionRepo_InvalidateBustsKey(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// Two upstream hits — once before invalidate, once after.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).Times(2)

	kv := newMemKV()
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())

	if _, err := repo.Get(context.Background(), sid); err != nil {
		t.Fatalf("warm: %v", err)
	}
	if !kv.has(keySession(sid)) {
		t.Fatal("expected session key to be present after first Get")
	}
	repo.Invalidate(context.Background(), sid)
	if kv.has(keySession(sid)) {
		t.Fatal("expected session key to be gone after Invalidate")
	}
	if _, err := repo.Get(context.Background(), sid); err != nil {
		t.Fatalf("Get after invalidate: %v", err)
	}
}

func TestCachedSessionRepo_RedisGetFailFallsBackToUpstream(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// Cache fails → upstream is called every time. We make sure the request
	// itself never errors out on a Redis failure.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).Times(2)

	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())

	for i := 0; i < 2; i++ {
		got, err := repo.Get(context.Background(), sid)
		if err != nil {
			t.Fatalf("Get %d: %v", i, err)
		}
		if got.ID != sid {
			t.Fatalf("Get %d returned wrong id", i)
		}
	}
}

func TestCachedSessionRepo_CorruptJSONRefreshes(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// One upstream hit because the corrupt entry forces a refresh.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).Times(1)

	kv := newMemKV()
	// Pre-populate with garbage so the cache must refresh.
	_ = kv.Set(context.Background(), keySession(sid), []byte("not json"), time.Minute)
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())

	got, err := repo.Get(context.Background(), sid)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ID != sid {
		t.Fatalf("Get returned wrong id")
	}
}

func TestCachedSessionRepo_SingleflightCollapsesConcurrentMisses(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// 50 goroutines hit a cold cache; singleflight must collapse the load.
	// We allow at most 5 upstream hits in case the goroutines barely race.
	mock.EXPECT().Get(gomock.Any(), sid).DoAndReturn(func(context.Context, uuid.UUID) (domain.Session, error) {
		// Tiny sleep widens the race window so that without singleflight
		// we'd see way more than 5 hits.
		time.Sleep(20 * time.Millisecond)
		return want, nil
	}).MinTimes(1).MaxTimes(5)

	kv := newMemKV()
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())

	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_, _ = repo.Get(context.Background(), sid)
		}()
	}
	wg.Wait()
}

func TestCachedSessionRepo_UpdateStatusInvalidates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// Get warms cache, UpdateStatus busts it, second Get refreshes.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).Times(2)
	mock.EXPECT().UpdateStatus(gomock.Any(), sid, "finished", true).Return(nil).Times(1)

	kv := newMemKV()
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())

	if _, err := repo.Get(context.Background(), sid); err != nil {
		t.Fatalf("warm: %v", err)
	}
	if err := repo.UpdateStatus(context.Background(), sid, "finished", true); err != nil {
		t.Fatalf("UpdateStatus: %v", err)
	}
	if kv.has(keySession(sid)) {
		t.Fatal("session key should be evicted after UpdateStatus")
	}
	if _, err := repo.Get(context.Background(), sid); err != nil {
		t.Fatalf("refresh: %v", err)
	}
}

func TestCachedSessionRepo_UpdateReportInvalidatesBothKeys(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()

	// Warm both caches so we can verify they both go away.
	mock.EXPECT().Get(gomock.Any(), sid).Return(sampleSession(uid, sid), nil).Times(1)
	mock.EXPECT().UpdateReport(gomock.Any(), sid, gomock.Any(), gomock.Any()).Return(nil).Times(1)

	kv := newMemKV()
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())
	rcache := NewReportCache(kv, time.Minute, testLog())

	if _, err := repo.Get(context.Background(), sid); err != nil {
		t.Fatalf("warm session: %v", err)
	}
	rcache.Store(context.Background(), sid, CachedReport{Status: "ready"})
	if !kv.has(keyReport(sid)) {
		t.Fatal("report key should be present after Store")
	}
	if err := repo.UpdateReport(context.Background(), sid, []byte(`{}`), "url"); err != nil {
		t.Fatalf("UpdateReport: %v", err)
	}
	if kv.has(keySession(sid)) {
		t.Fatal("session key should be evicted")
	}
	if kv.has(keyReport(sid)) {
		t.Fatal("report key should be evicted")
	}
}

func TestCachedSessionRepo_NoUpstreamLeakOnHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// Exactly ONE upstream hit across 10 reads.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).Times(1)

	kv := newMemKV()
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())
	for i := 0; i < 10; i++ {
		if _, err := repo.Get(context.Background(), sid); err != nil {
			t.Fatalf("Get %d: %v", i, err)
		}
	}
}

func TestCachedSessionRepo_ConcurrentInvalidateSafe(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockSessionRepo(ctrl)
	uid, sid := uuid.New(), uuid.New()
	want := sampleSession(uid, sid)

	// Anything from 1..N upstream calls is fine — we're testing for races,
	// not exact counts.
	mock.EXPECT().Get(gomock.Any(), sid).Return(want, nil).MinTimes(1).MaxTimes(50)

	kv := newMemKV()
	repo := NewCachedSessionRepo(mock, kv, time.Minute, testLog())

	var wg sync.WaitGroup
	for i := 0; i < 25; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _, _ = repo.Get(context.Background(), sid) }()
		go func() { defer wg.Done(); repo.Invalidate(context.Background(), sid) }()
	}
	wg.Wait()
}

// ── report cache tests ────────────────────────────────────────────────────

func TestReportCache_LookupMissThenStoreThenHit(t *testing.T) {
	t.Parallel()
	sid := uuid.New()
	kv := newMemKV()
	rc := NewReportCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if _, ok := rc.Lookup(context.Background(), sid); ok {
		t.Fatal("expected miss on cold cache")
	}
	rc.Store(context.Background(), sid, CachedReport{Status: "ready", Report: domain.ReportDraft{OverallScore: 87}})
	got, ok := rc.Lookup(context.Background(), sid)
	if !ok {
		t.Fatal("expected hit after store")
	}
	if got.Status != "ready" || got.Report.OverallScore != 87 {
		t.Fatalf("unexpected cached value: %+v", got)
	}
}

func TestReportCache_RedisGetFailFalseIsMiss(t *testing.T) {
	t.Parallel()
	sid := uuid.New()
	kv := newMemKV()
	kv.failGet = true
	rc := NewReportCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, ok := rc.Lookup(context.Background(), sid); ok {
		t.Fatal("redis Get failure must surface as miss")
	}
}

func TestReportCache_NilKVIsSafe(t *testing.T) {
	t.Parallel()
	sid := uuid.New()
	rc := NewReportCache(nil, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, ok := rc.Lookup(context.Background(), sid); ok {
		t.Fatal("nil KV must surface as miss")
	}
	rc.Store(context.Background(), sid, CachedReport{Status: "ready"}) // must not panic
	rc.Invalidate(context.Background(), sid)                           // must not panic
}

func TestReportCache_CorruptJSONIsMiss(t *testing.T) {
	t.Parallel()
	sid := uuid.New()
	kv := newMemKV()
	_ = kv.Set(context.Background(), keyReport(sid), []byte("not json"), time.Minute)
	rc := NewReportCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, ok := rc.Lookup(context.Background(), sid); ok {
		t.Fatal("corrupt JSON must surface as miss")
	}
}
