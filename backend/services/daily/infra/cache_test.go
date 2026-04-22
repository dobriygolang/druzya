// cache_test.go covers CachedStreakRepo against an in-memory KV. Mirrors
// the test layout used in profile/infra/cache_test.go and rating/infra/cache_test.go.
package infra

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/daily/domain"
	"druz9/daily/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

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

	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, nil)
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
	repo := NewCachedStreakRepo(mock, kv, 10*time.Second, nil)
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	now = now.Add(11 * time.Second)
	if _, err := repo.Get(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
}

func TestCachedStreakRepo_Get_RedisErrorFallback(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil).Times(1)
	kv := newMemKV()
	kv.failGet = true
	repo := NewCachedStreakRepo(mock, kv, time.Minute, nil)
	got, err := repo.Get(context.Background(), uid)
	if err != nil {
		t.Fatalf("expected fallback, got %v", err)
	}
	if got.CurrentStreak != 7 {
		t.Fatalf("got %+v", got)
	}
}

func TestCachedStreakRepo_Get_CorruptJSONFallback(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil).Times(1)
	kv := newMemKV()
	kv.putRaw(keyStreak(uid), []byte("xxxx"))
	repo := NewCachedStreakRepo(mock, kv, time.Minute, nil)
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
	repo := NewCachedStreakRepo(mock, kv, time.Minute, nil)
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
	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, nil)
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
	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, nil)

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
	repo := NewCachedStreakRepo(mock, newMemKV(), time.Minute, nil)
	if _, err := repo.Get(context.Background(), uid); err == nil {
		t.Fatal("expected error")
	}
}

func TestCachedStreakRepo_DefaultsApplied(t *testing.T) {
	t.Parallel()
	repo := NewCachedStreakRepo(nil, newMemKV(), 0, nil)
	if repo.ttl != DefaultStreakTTL {
		t.Fatalf("default TTL not applied: %s", repo.ttl)
	}
}

func TestCachedStreakRepo_Invalidate(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	mock := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	mock.EXPECT().Get(gomock.Any(), uid).Return(sampleState(), nil)
	kv := newMemKV()
	repo := NewCachedStreakRepo(mock, kv, time.Minute, nil)
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
