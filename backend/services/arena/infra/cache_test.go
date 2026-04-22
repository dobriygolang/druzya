package infra

import (
	"context"
	"encoding/json"
	"errors"
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
	c := NewMatchInfoCache(kv, time.Minute, nil, loader)

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
	c := NewMatchInfoCache(kv, 30*time.Second, nil, loader)

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
	c := NewMatchInfoCache(kv, time.Minute, nil, loader)
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
	c := NewMatchInfoCache(kv, time.Minute, nil, loader)

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
	c := NewMatchInfoCache(kv, time.Minute, nil, loader)

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
	c := NewMatchInfoCache(kv, time.Minute, nil, loader)

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
	c := NewMatchInfoCache(kv, time.Minute, nil, loader)

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
	c := NewQueueStatsCache(kv, 10*time.Second, nil, loader)

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
	c := NewQueueStatsCache(kv, 10*time.Second, nil, loader)

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
	c := NewQueueStatsCache(kv, 10*time.Second, nil, loader)
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
	c := NewQueueStatsCache(kv, 10*time.Second, nil, loader)
	got, err := c.Get(context.Background(), enums.ArenaModeSolo1v1, enums.SectionSQL)
	if err != nil {
		t.Fatal(err)
	}
	if got.Waiting != 99 {
		t.Fatalf("expected fallback to upstream, got %+v", got)
	}
}
