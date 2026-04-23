package infra

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/arena/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// memKV is an in-memory KV with TTL + injectable failure modes. It mirrors
// the helper in profile/infra/cache_test.go so the two cache suites read the
// same. NOT exported.
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
		return "", errors.New("simulated redis Get failure")
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

func (m *memKV) putRaw(key, raw string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store[key] = memEntry{val: []byte(raw)}
}

// ── MatchInfoCache ────────────────────────────────────────────────────────

func sampleSnap() MatchInfoSnapshot {
	return MatchInfoSnapshot{
		Match: domain.Match{
			ID:     uuid.New(),
			Mode:   enums.ArenaModeSolo1v1,
			Status: enums.MatchStatusActive,
		},
	}
}

func TestMatchInfoCache_MissThenHit(t *testing.T) {
	t.Parallel()
	want := sampleSnap()
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID) (MatchInfoSnapshot, error) {
		calls.Add(1)
		return want, nil
	}
	kv := newMemKV()
	c := NewMatchInfoCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	got, err := c.Get(context.Background(), want.Match.ID)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if got.Match.ID != want.Match.ID {
		t.Fatalf("got %+v", got)
	}
	if _, err := c.Get(context.Background(), want.Match.ID); err != nil {
		t.Fatalf("second: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected loader to be called once, got %d", calls.Load())
	}
}

func TestMatchInfoCache_TTLExpiry(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID) (MatchInfoSnapshot, error) {
		calls.Add(1)
		return MatchInfoSnapshot{Match: domain.Match{ID: id}}, nil
	}
	kv := newMemKV()
	now := time.Now()
	kv.now = func() time.Time { return now }
	c := NewMatchInfoCache(kv, 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	if _, err := c.Get(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	now = now.Add(31 * time.Second) // expire
	if _, err := c.Get(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 loader calls after TTL expiry, got %d", calls.Load())
	}
}

func TestMatchInfoCache_Invalidate(t *testing.T) {
	t.Parallel()
	want := sampleSnap()
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID) (MatchInfoSnapshot, error) {
		calls.Add(1)
		return want, nil
	}
	kv := newMemKV()
	c := NewMatchInfoCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)
	if _, err := c.Get(context.Background(), want.Match.ID); err != nil {
		t.Fatal(err)
	}
	c.Invalidate(context.Background(), want.Match.ID)
	if kv.has(keyMatchInfo(want.Match.ID)) {
		t.Fatalf("expected key to be evicted")
	}
	if _, err := c.Get(context.Background(), want.Match.ID); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected loader to be called twice after invalidate, got %d", calls.Load())
	}
}

func TestMatchInfoCache_RedisGetFailure_FallsBack(t *testing.T) {
	t.Parallel()
	want := sampleSnap()
	loader := func(_ context.Context, _ uuid.UUID) (MatchInfoSnapshot, error) { return want, nil }
	kv := newMemKV()
	kv.failGet = true
	c := NewMatchInfoCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	got, err := c.Get(context.Background(), want.Match.ID)
	if err != nil {
		t.Fatalf("expected fallback to upstream, got error: %v", err)
	}
	if got.Match.ID != want.Match.ID {
		t.Fatalf("got %+v", got)
	}
}

func TestMatchInfoCache_CorruptJSON_RefreshFromUpstream(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	want := MatchInfoSnapshot{Match: domain.Match{ID: id, Status: enums.MatchStatusActive}}
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID) (MatchInfoSnapshot, error) {
		calls.Add(1)
		return want, nil
	}
	kv := newMemKV()
	kv.putRaw(keyMatchInfo(id), "{not-json")
	c := NewMatchInfoCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	got, err := c.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if got.Match.ID != id {
		t.Fatalf("expected refreshed value, got %+v", got)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected upstream once after corrupt JSON, got %d", calls.Load())
	}
}

func TestMatchInfoCache_LoaderError_Propagates(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("pg down")
	loader := func(_ context.Context, _ uuid.UUID) (MatchInfoSnapshot, error) {
		return MatchInfoSnapshot{}, wantErr
	}
	kv := newMemKV()
	c := NewMatchInfoCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	_, err := c.Get(context.Background(), uuid.New())
	if !errors.Is(err, wantErr) {
		t.Fatalf("want %v, got %v", wantErr, err)
	}
}

func TestMatchInfoCache_Concurrent_SingleflightCollapses(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	calls := atomic.Int64{}
	gate := make(chan struct{})
	loader := func(_ context.Context, _ uuid.UUID) (MatchInfoSnapshot, error) {
		calls.Add(1)
		<-gate
		return MatchInfoSnapshot{Match: domain.Match{ID: id}}, nil
	}
	kv := newMemKV()
	c := NewMatchInfoCache(kv, time.Minute, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = c.Get(context.Background(), id)
		}()
	}
	// Give all goroutines time to enter singleflight, then release the loader.
	time.Sleep(20 * time.Millisecond)
	close(gate)
	wg.Wait()

	if got := calls.Load(); got != 1 {
		t.Fatalf("expected loader called once under singleflight, got %d", got)
	}
}

// ── QueueStatsCache ───────────────────────────────────────────────────────

func TestQueueStatsCache_MissThenHit(t *testing.T) {
	t.Parallel()
	want := QueueStats{
		Mode:    enums.ArenaModeSolo1v1,
		Section: enums.SectionAlgorithms,
		Waiting: 12,
	}
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ enums.ArenaMode, _ enums.Section) (QueueStats, error) {
		calls.Add(1)
		return want, nil
	}
	kv := newMemKV()
	c := NewQueueStatsCache(kv, 10*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	got, err := c.Get(context.Background(), want.Mode, want.Section)
	if err != nil {
		t.Fatal(err)
	}
	if got.Waiting != 12 {
		t.Fatalf("got %+v", got)
	}
	if _, err := c.Get(context.Background(), want.Mode, want.Section); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("loader called %d times, want 1", calls.Load())
	}
}

func TestQueueStatsCache_TTLExpiry(t *testing.T) {
	t.Parallel()
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ enums.ArenaMode, _ enums.Section) (QueueStats, error) {
		calls.Add(1)
		return QueueStats{Waiting: 1}, nil
	}
	kv := newMemKV()
	now := time.Now()
	kv.now = func() time.Time { return now }
	c := NewQueueStatsCache(kv, 10*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	if _, err := c.Get(context.Background(), enums.ArenaModeRanked, enums.SectionGo); err != nil {
		t.Fatal(err)
	}
	now = now.Add(11 * time.Second)
	if _, err := c.Get(context.Background(), enums.ArenaModeRanked, enums.SectionGo); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected loader to be called twice after TTL expiry, got %d", calls.Load())
	}
}

func TestQueueStatsCache_Invalidate(t *testing.T) {
	t.Parallel()
	loader := func(_ context.Context, m enums.ArenaMode, s enums.Section) (QueueStats, error) {
		return QueueStats{Mode: m, Section: s, Waiting: 7}, nil
	}
	kv := newMemKV()
	c := NewQueueStatsCache(kv, 10*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)
	if _, err := c.Get(context.Background(), enums.ArenaModeSolo1v1, enums.SectionAlgorithms); err != nil {
		t.Fatal(err)
	}
	c.Invalidate(context.Background(), enums.ArenaModeSolo1v1, enums.SectionAlgorithms)
	if kv.has(keyQueueStats(enums.ArenaModeSolo1v1, enums.SectionAlgorithms)) {
		t.Fatalf("expected key evicted")
	}
}

func TestQueueStatsCache_KeyContainsModeAndSection(t *testing.T) {
	t.Parallel()
	// Two distinct keys must NOT collide; verifies key derivation.
	k1 := keyQueueStats(enums.ArenaModeSolo1v1, enums.SectionAlgorithms)
	k2 := keyQueueStats(enums.ArenaModeRanked, enums.SectionAlgorithms)
	if k1 == k2 {
		t.Fatalf("queue_stats keys must differ across modes; got %q", k1)
	}
	// Sanity: marshal/unmarshal round-trips a QueueStats.
	want := QueueStats{Mode: enums.ArenaModeRanked, Section: enums.SectionGo, Waiting: 3, EstWaitMs: 2500}
	raw, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var got QueueStats
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
}

func TestQueueStatsCache_RedisFailure_FallsBack(t *testing.T) {
	t.Parallel()
	loader := func(_ context.Context, _ enums.ArenaMode, _ enums.Section) (QueueStats, error) {
		return QueueStats{Waiting: 99}, nil
	}
	kv := newMemKV()
	kv.failGet = true
	c := NewQueueStatsCache(kv, 10*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)
	got, err := c.Get(context.Background(), enums.ArenaModeSolo1v1, enums.SectionSQL)
	if err != nil {
		t.Fatal(err)
	}
	if got.Waiting != 99 {
		t.Fatalf("expected fallback to upstream, got %+v", got)
	}
}

// ── MatchHistoryCache ─────────────────────────────────────────────────────

// sampleHistory builds a deterministic 1-row snapshot, sized so JSON round-
// trips exercise UUID + timestamp encoding (the two forms most likely to
// silently break under Marshal/Unmarshal drift).
func sampleHistory(uid uuid.UUID) MatchHistorySnapshot {
	return MatchHistorySnapshot{
		Items: []domain.MatchHistoryEntry{
			{
				MatchID:          uuid.New(),
				FinishedAt:       time.Now().UTC().Truncate(time.Second),
				Mode:             enums.ArenaModeSolo1v1,
				Section:          enums.SectionAlgorithms,
				OpponentUserID:   uid, // any non-nil
				OpponentUsername: "opp",
				Result:           domain.MatchResultWin,
				LPChange:         15,
				DurationSeconds:  240,
			},
		},
		Total: 1,
	}
}

func TestCachedMatchHistoryRepo_MissThenHit(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	want := sampleHistory(uid)
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID, _ MatchHistoryFilters) (MatchHistorySnapshot, error) {
		calls.Add(1)
		return want, nil
	}
	kv := newMemKV()
	c := NewMatchHistoryCache(kv, 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	f := MatchHistoryFilters{Limit: 20, Offset: 0}
	if _, err := c.Get(context.Background(), uid, f); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(context.Background(), uid, f); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected loader called once, got %d", got)
	}
}

func TestCachedMatchHistoryRepo_TTLExpire(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID, _ MatchHistoryFilters) (MatchHistorySnapshot, error) {
		calls.Add(1)
		return sampleHistory(uid), nil
	}
	kv := newMemKV()
	now := time.Now()
	kv.now = func() time.Time { return now }
	c := NewMatchHistoryCache(kv, 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	f := MatchHistoryFilters{Limit: 20}
	if _, err := c.Get(context.Background(), uid, f); err != nil {
		t.Fatal(err)
	}
	now = now.Add(31 * time.Second)
	if _, err := c.Get(context.Background(), uid, f); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("expected loader called twice after TTL, got %d", got)
	}
}

func TestCachedMatchHistoryRepo_Invalidate(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID, _ MatchHistoryFilters) (MatchHistorySnapshot, error) {
		calls.Add(1)
		return sampleHistory(uid), nil
	}
	kv := newMemKV()
	c := NewMatchHistoryCache(kv, 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	f := MatchHistoryFilters{Limit: 20}
	if _, err := c.Get(context.Background(), uid, f); err != nil {
		t.Fatal(err)
	}
	c.Invalidate(context.Background(), uid)
	if _, err := c.Get(context.Background(), uid, f); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("expected loader called twice after invalidate, got %d", got)
	}
}

func TestCachedMatchHistoryRepo_RedisFailure_Fallback(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	want := sampleHistory(uid)
	loader := func(_ context.Context, _ uuid.UUID, _ MatchHistoryFilters) (MatchHistorySnapshot, error) {
		return want, nil
	}
	kv := newMemKV()
	kv.failGet = true
	c := NewMatchHistoryCache(kv, 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	got, err := c.Get(context.Background(), uid, MatchHistoryFilters{Limit: 20})
	if err != nil {
		t.Fatalf("expected fallback to upstream: %v", err)
	}
	if got.Total != want.Total || len(got.Items) != len(want.Items) {
		t.Fatalf("got %+v", got)
	}
}

func TestCachedMatchHistoryRepo_Concurrent_Singleflight(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	calls := atomic.Int64{}
	gate := make(chan struct{})
	loader := func(_ context.Context, _ uuid.UUID, _ MatchHistoryFilters) (MatchHistorySnapshot, error) {
		calls.Add(1)
		<-gate
		return sampleHistory(uid), nil
	}
	kv := newMemKV()
	c := NewMatchHistoryCache(kv, 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	f := MatchHistoryFilters{Limit: 20}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = c.Get(context.Background(), uid, f)
		}()
	}
	time.Sleep(20 * time.Millisecond)
	close(gate)
	wg.Wait()

	if got := calls.Load(); got != 1 {
		t.Fatalf("expected singleflight to collapse 8 calls into 1, got %d", got)
	}
}

func TestCachedMatchHistoryRepo_DifferentFiltersAreIndependent(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	calls := atomic.Int64{}
	loader := func(_ context.Context, _ uuid.UUID, _ MatchHistoryFilters) (MatchHistorySnapshot, error) {
		calls.Add(1)
		return MatchHistorySnapshot{Total: 1}, nil
	}
	kv := newMemKV()
	c := NewMatchHistoryCache(kv, 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)), loader)

	// Three distinct filter tuples must each populate the loader exactly
	// once; the 4th call repeats the first and must hit the cache.
	if _, err := c.Get(context.Background(), uid, MatchHistoryFilters{Limit: 20, Offset: 0}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(context.Background(), uid, MatchHistoryFilters{Limit: 20, Offset: 20}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Get(context.Background(), uid, MatchHistoryFilters{Limit: 20, Mode: enums.ArenaModeRanked}); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 3 {
		t.Fatalf("expected 3 distinct loader calls, got %d", got)
	}
	if _, err := c.Get(context.Background(), uid, MatchHistoryFilters{Limit: 20, Offset: 0}); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 3 {
		t.Fatalf("repeated filter must hit cache; loader called %d times total", got)
	}
}

func TestCachedMatchHistoryRepo_KeyContainsUserAndEpoch(t *testing.T) {
	t.Parallel()
	// Two distinct users must NEVER share a key.
	uid1, uid2 := uuid.New(), uuid.New()
	f := MatchHistoryFilters{Limit: 20, Offset: 0}
	if keyMatchHistory(uid1, 0, f) == keyMatchHistory(uid2, 0, f) {
		t.Fatalf("different users must not share key")
	}
	// Same user, different epoch must produce a different key (proves
	// Invalidate's epoch bump can never accidentally collide).
	if keyMatchHistory(uid1, 0, f) == keyMatchHistory(uid1, 1, f) {
		t.Fatalf("epoch bump must change key")
	}
}

// ── CachedHistoryRepo wrapper ─────────────────────────────────────────────

// stubMatchRepo is a hand-rolled MatchRepo whose only job is to surface the
// ListByUser arguments and counts back to the test. It's deliberately not a
// gomock — the wrapper is so thin that gomock setup overhead would obscure
// the assertion.
type stubMatchRepo struct {
	domain.MatchRepo
	calls atomic.Int64
	items []domain.MatchHistoryEntry
	total int
	err   error
}

func (s *stubMatchRepo) ListByUser(_ context.Context, _ uuid.UUID, _, _ int, _ enums.ArenaMode, _ enums.Section) ([]domain.MatchHistoryEntry, int, error) {
	s.calls.Add(1)
	return s.items, s.total, s.err
}

func TestCachedHistoryRepo_PassThroughListByUser_CachesResult(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	stub := &stubMatchRepo{items: []domain.MatchHistoryEntry{{MatchID: uuid.New()}}, total: 1}
	cache := NewMatchHistoryCache(newMemKV(), 30*time.Second, slog.New(slog.NewTextHandler(io.Discard, nil)),
		func(ctx context.Context, u uuid.UUID, f MatchHistoryFilters) (MatchHistorySnapshot, error) {
			it, total, err := stub.ListByUser(ctx, u, f.Limit, f.Offset, f.Mode, f.Section)
			return MatchHistorySnapshot{Items: it, Total: total}, err
		},
	)
	repo := NewCachedHistoryRepo(stub, cache)

	for i := 0; i < 5; i++ {
		_, _, err := repo.ListByUser(context.Background(), uid, 20, 0, "", "")
		if err != nil {
			t.Fatal(err)
		}
	}
	if stub.calls.Load() != 1 {
		t.Fatalf("expected upstream called once across 5 reads, got %d", stub.calls.Load())
	}
}
