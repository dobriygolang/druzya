// cache_test.go covers CachedStreakRepo against an in-memory KV. Mirrors
// the test layout used in profile/infra/cache_test.go and rating/infra/cache_test.go.
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

	"druz9/daily/domain"
	"druz9/daily/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// testLog returns an explicit discard logger for unit tests. We pass this
// rather than nil because constructors now panic on nil log (anti-fallback
// policy).
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

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

func (m *memKV) putRaw(key string, raw []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store[key] = memEntry{val: append([]byte(nil), raw...)}
}

func sampleState() domain.StreakState {
	return domain.StreakState{CurrentStreak: 7, LongestStreak: 14, FreezeTokens: 2}
}

func TestCachedStreakRepo_Get_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil).Times(1)

	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, testLog())
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	got, err := repo.Get(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	if got.CurrentStreak != 7 {
		t.Fatalf("hit mismatch: %+v", got)
	}
}

func TestCachedStreakRepo_Get_TTLExpire(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil).Times(2)
	now := time.Now()
	kv := newMemKV()
	kv.now = func() time.Time { return now }
	repo := NewCachedStreakRepo(mock, kv, 10*time.Second, testLog())
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	now = now.Add(11 * time.Second)
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedStreakRepo_Get_RedisErrorPropagates(t *testing.T) {
	t.Parallel()
	// fallbacks were removed deliberately — Redis is required, errors propagate.
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	// Upstream MUST NOT be invoked when Redis Get fails.
	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedStreakRepo(mock, kv, time.Minute, testLog())
	if _, err := repo.Get(context.Background(), uid); err == nil {
		t.Fatalf("expected error when Redis Get fails, got nil")
	}
	_ = ctrl
}

func TestCachedStreakRepo_Get_CorruptJSONFallback(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil).Times(1)
	kv := newMemKV()
	kv.putRaw(keyStreak(uid), []byte("xxxx"))
	repo := NewCachedStreakRepo(mock, kv, time.Minute, testLog())
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedStreakRepo_Update_InvalidatesUserKey(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil).Times(2)
	mock.EXPECT().Update(gomock.Any(), uid, gomock.Any()).Return(nil).Times(1)

	kv := newMemKV()
	repo := NewCachedStreakRepo(mock, kv, time.Minute, testLog())
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyStreak(uid)) {
		t.Fatal("expected cached after Get")
	}
	if err := repo.Update(context.Background(), uid, sampleState()); err != nil {
		t.Fatal(err)
	}
	if kv.has(keyStreak(uid)) {
		t.Fatal("expected invalidated")
	}
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedStreakRepo_Update_DelegateError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Update(gomock.Any(), uid, gomock.Any()).Return(errors.New("pg down")).Times(1)
	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, testLog())
	if err := repo.Update(context.Background(), uid, sampleState()); err == nil {
		t.Fatal("expected error")
	}
}

func TestCachedStreakRepo_Get_SingleflightCollapsesConcurrent(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).DoAndReturn(func(_ context.Context, _ uuid.UUID) (domain.StreakState, error) {
		time.Sleep(20 * time.Millisecond)
		return sampleState(), nil
	}).Times(1)
	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, testLog())

	const N = 8
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_, _ = repo.Get(context.Background(), uid)
		}()
	}
	wg.Wait()
}

func TestCachedStreakRepo_Get_DelegateError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(domain.StreakState{}, errors.New("pg down"))
	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, testLog())
	if _, err := repo.Get(context.Background(), uid); err == nil {
		t.Fatal("expected error")
	}
}

func TestCachedStreakRepo_DefaultsApplied(t *testing.T) {
	t.Parallel()
	repo := NewCachedStreakRepo(nil, newMemKV(), 0, testLog())
	if repo.ttl != DefaultStreakTTL {
		t.Fatalf("default TTL not applied: %s", repo.ttl)
	}
}

func TestCachedStreakRepo_NilLogPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatalf("expected panic on nil logger")
		}
	}()
	_ = NewCachedStreakRepo(nil, newMemKV(), 0, nil)
}

func TestCachedStreakRepo_Invalidate(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil)
	kv := newMemKV()
	repo := NewCachedStreakRepo(mock, kv, time.Minute, testLog())
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	repo.Invalidate(context.Background(), uid)
	if kv.has(keyStreak(uid)) {
		t.Fatal("expected invalidated")
	}
}

func TestRedisKV_DelEmptyIsNoop(t *testing.T) {
	t.Parallel()
	kv := redisKV{}
	if err := kv.Del(context.Background()); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

// ── CachedKataRepo ─────────────────────────────────────────────────────────

func sampleHistory(today time.Time) []domain.HistoryEntry {
	pass := true
	return []domain.HistoryEntry{
		{Date: today, TaskID: uuid.New(), Passed: &pass},
		{Date: today.AddDate(0, 0, -1), TaskID: uuid.New(), FreezeUsed: true},
	}
}

func todayUTC() time.Time {
	n := time.Now().UTC()
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

func TestCachedKataRepo_HistoryLast30_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().HistoryLast30(gomock.Any(), uid, today).
		Return(sampleHistory(today), nil).Times(1)

	repo := NewCachedKataRepo(mock, newMemKV(), 0, testLog(), nil)
	if _, err := repo.HistoryLast30(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
	got, err := repo.HistoryLast30(context.Background(), uid, today)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("hit mismatch: %+v", got)
	}
}

func TestCachedKataRepo_HistoryLast30_HitDoesNotCallUpstream(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().HistoryLast30(gomock.Any(), uid, today).
		Return(sampleHistory(today), nil).Times(1)
	repo := NewCachedKataRepo(mock, newMemKV(), 0, testLog(), nil)
	for i := 0; i < 5; i++ {
		if _, err := repo.HistoryLast30(context.Background(), uid, today); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCachedKataRepo_TTL_ClampedToMin_NearMidnight(t *testing.T) {
	t.Parallel()
	// Pin "now" to 2 seconds before midnight UTC; expected TTL = max(2s, minTTL).
	near := time.Date(2030, 1, 1, 23, 59, 58, 0, time.UTC)
	got := timeUntilNextUTCMidnight(near, DefaultKataMinTTL)
	if got != DefaultKataMinTTL {
		t.Fatalf("expected clamp to min %s, got %s", DefaultKataMinTTL, got)
	}
}

func TestCachedKataRepo_TTL_FullDay(t *testing.T) {
	t.Parallel()
	// Pin "now" to 00:00:00 UTC — expect ~24h.
	morning := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	got := timeUntilNextUTCMidnight(morning, DefaultKataMinTTL)
	if got != 24*time.Hour {
		t.Fatalf("expected 24h, got %s", got)
	}
}

func TestCachedKataRepo_HistoryLast30_CorruptJSONFallback(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().HistoryLast30(gomock.Any(), uid, today).
		Return(sampleHistory(today), nil).Times(1)
	kv := newMemKV()
	kv.putRaw(keyKataHistory(uid, today), []byte("{not-json"))
	repo := NewCachedKataRepo(mock, kv, 0, testLog(), nil)
	if _, err := repo.HistoryLast30(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
}

func TestCachedKataRepo_HistoryLast30_RedisErrorPropagates(t *testing.T) {
	t.Parallel()
	// fallbacks were removed deliberately — Redis is required, errors propagate.
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	// Upstream MUST NOT be invoked when Redis Get itself fails.
	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedKataRepo(mock, kv, 0, testLog(), nil)
	if _, err := repo.HistoryLast30(context.Background(), uid, today); err == nil {
		t.Fatalf("expected error when Redis Get fails, got nil")
	}
	_ = ctrl
}

func TestCachedKataRepo_MarkSubmitted_InvalidatesHistory(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().HistoryLast30(gomock.Any(), uid, today).
		Return(sampleHistory(today), nil).Times(2)
	mock.EXPECT().MarkSubmitted(gomock.Any(), uid, today, true).Return(nil).Times(1)
	kv := newMemKV()
	repo := NewCachedKataRepo(mock, kv, 0, testLog(), nil)
	if _, err := repo.HistoryLast30(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyKataHistory(uid, today)) {
		t.Fatal("expected cached after first read")
	}
	if err := repo.MarkSubmitted(context.Background(), uid, today, true); err != nil {
		t.Fatal(err)
	}
	if kv.has(keyKataHistory(uid, today)) {
		t.Fatal("expected invalidated after MarkSubmitted")
	}
	// Second read forces a refetch (proves invalidation).
	if _, err := repo.HistoryLast30(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
}

func TestCachedKataRepo_GetOrAssign_InvalidatesOnCreate(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	taskID := uuid.New()
	// Pre-seed cache.
	kv := newMemKV()
	kv.putRaw(keyKataHistory(uid, today), []byte("[]"))
	// First call: created=true → expect invalidate.
	mock.EXPECT().GetOrAssign(gomock.Any(), uid, today, taskID, false, false).
		Return(domain.Assignment{UserID: uid, KataDate: today, TaskID: taskID}, true, nil).Times(1)
	repo := NewCachedKataRepo(mock, kv, 0, testLog(), nil)
	if _, _, err := repo.GetOrAssign(context.Background(), uid, today, taskID, false, false); err != nil {
		t.Fatal(err)
	}
	if kv.has(keyKataHistory(uid, today)) {
		t.Fatal("expected invalidated on create")
	}
}

func TestCachedKataRepo_HistoryLast30_SingleflightCollapsesConcurrent(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().HistoryLast30(gomock.Any(), uid, today).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ time.Time) ([]domain.HistoryEntry, error) {
			time.Sleep(20 * time.Millisecond)
			return sampleHistory(today), nil
		}).Times(1)
	repo := NewCachedKataRepo(mock, newMemKV(), 0, testLog(), nil)

	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_, _ = repo.HistoryLast30(context.Background(), uid, today)
		}()
	}
	wg.Wait()
}

func TestCachedKataRepo_DefaultsApplied(t *testing.T) {
	t.Parallel()
	repo := NewCachedKataRepo(nil, newMemKV(), 0, testLog(), nil)
	if repo.minTTL != DefaultKataMinTTL {
		t.Fatalf("default minTTL not applied: %s", repo.minTTL)
	}
	if repo.now == nil {
		t.Fatal("default clock not applied")
	}
}

// ── CachedCalendarRepo ─────────────────────────────────────────────────────

func sampleCalendar(uid uuid.UUID) domain.InterviewCalendar {
	return domain.InterviewCalendar{
		ID:            uuid.New(),
		UserID:        uid,
		CompanyID:     uuid.New(),
		Role:          "be",
		InterviewDate: time.Date(2030, 6, 1, 0, 0, 0, 0, time.UTC),
		CurrentLevel:  "mid",
	}
}

func TestCachedCalendarRepo_GetActive_MissThenHit(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().GetActive(gomock.Any(), uid, today).
		Return(sampleCalendar(uid), nil).Times(1)
	repo := NewCachedCalendarRepo(mock, newMemKV(), 0, testLog(), func() time.Time { return today })
	if _, err := repo.GetActive(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetActive(context.Background(), uid, today)
	if err != nil {
		t.Fatal(err)
	}
	if got.Role != "be" {
		t.Fatalf("hit mismatch: %+v", got)
	}
}

func TestCachedCalendarRepo_GetActive_NotFoundCachedNegative(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().GetActive(gomock.Any(), uid, today).
		Return(domain.InterviewCalendar{}, domain.ErrNotFound).Times(1)
	repo := NewCachedCalendarRepo(mock, newMemKV(), 0, testLog(), func() time.Time { return today })
	for i := 0; i < 3; i++ {
		_, err := repo.GetActive(context.Background(), uid, today)
		if !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("expected ErrNotFound, got %v", err)
		}
	}
}

func TestCachedCalendarRepo_GetActive_CorruptJSONFallback(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().GetActive(gomock.Any(), uid, today).
		Return(sampleCalendar(uid), nil).Times(1)
	kv := newMemKV()
	kv.putRaw(keyCalendar(uid, today), []byte("xxx"))
	repo := NewCachedCalendarRepo(mock, kv, 0, testLog(), func() time.Time { return today })
	if _, err := repo.GetActive(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
}

func TestCachedCalendarRepo_GetActive_RedisErrorPropagates(t *testing.T) {
	t.Parallel()
	// fallbacks were removed deliberately — Redis is required, errors propagate.
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	// Upstream MUST NOT be invoked when Redis Get itself fails.
	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedCalendarRepo(mock, kv, 0, testLog(), func() time.Time { return today })
	if _, err := repo.GetActive(context.Background(), uid, today); err == nil {
		t.Fatalf("expected error when Redis Get fails, got nil")
	}
	_ = ctrl
}

func TestCachedCalendarRepo_GetActive_DelegateError(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().GetActive(gomock.Any(), uid, today).
		Return(domain.InterviewCalendar{}, errors.New("pg down")).Times(1)
	repo := NewCachedCalendarRepo(mock, newMemKV(), 0, testLog(), func() time.Time { return today })
	if _, err := repo.GetActive(context.Background(), uid, today); err == nil {
		t.Fatal("expected error")
	}
}

func TestCachedCalendarRepo_Upsert_InvalidatesUserKey(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().GetActive(gomock.Any(), uid, today).
		Return(sampleCalendar(uid), nil).Times(2)
	mock.EXPECT().Upsert(gomock.Any(), gomock.Any()).
		Return(sampleCalendar(uid), nil).Times(1)
	kv := newMemKV()
	repo := NewCachedCalendarRepo(mock, kv, 0, testLog(), func() time.Time { return today })
	if _, err := repo.GetActive(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
	if !kv.has(keyCalendar(uid, today)) {
		t.Fatal("expected cached after Get")
	}
	if _, err := repo.Upsert(context.Background(), domain.InterviewCalendar{UserID: uid}); err != nil {
		t.Fatal(err)
	}
	if kv.has(keyCalendar(uid, today)) {
		t.Fatal("expected invalidated after Upsert")
	}
	if _, err := repo.GetActive(context.Background(), uid, today); err != nil {
		t.Fatal(err)
	}
}

func TestCachedCalendarRepo_GetActive_SingleflightCollapsesConcurrent(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	today := todayUTC()
	mock.EXPECT().GetActive(gomock.Any(), uid, today).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ time.Time) (domain.InterviewCalendar, error) {
			time.Sleep(20 * time.Millisecond)
			return sampleCalendar(uid), nil
		}).Times(1)
	repo := NewCachedCalendarRepo(mock, newMemKV(), 0, testLog(), func() time.Time { return today })

	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_, _ = repo.GetActive(context.Background(), uid, today)
		}()
	}
	wg.Wait()
}

func TestCachedCalendarRepo_DefaultsApplied(t *testing.T) {
	t.Parallel()
	repo := NewCachedCalendarRepo(nil, newMemKV(), 0, testLog(), nil)
	if repo.ttl != DefaultCalendarTTL {
		t.Fatalf("default TTL not applied: %s", repo.ttl)
	}
	if repo.now == nil {
		t.Fatal("default clock not applied")
	}
}
