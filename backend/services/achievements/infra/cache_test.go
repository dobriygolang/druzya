package infra

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/achievements/domain"

	"github.com/google/uuid"
)

// testLog returns an explicit discard logger for unit tests. Constructors
// now panic on nil log (anti-fallback policy).
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// memKV — in-memory KV для тестов.
type memKV struct {
	mu sync.Mutex
	m  map[string][]byte
}

func newMemKV() *memKV { return &memKV{m: map[string][]byte{}} }

func (k *memKV) Get(_ context.Context, key string) (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	v, ok := k.m[key]
	if !ok {
		return "", ErrCacheMiss
	}
	return string(v), nil
}
func (k *memKV) Set(_ context.Context, key string, v []byte, _ time.Duration) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.m[key] = append([]byte(nil), v...)
	return nil
}
func (k *memKV) Del(_ context.Context, keys ...string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	for _, key := range keys {
		delete(k.m, key)
	}
	return nil
}

// stubRepo — простой in-memory repo для cache-тестов.
type stubRepo struct {
	mu       sync.Mutex
	listN    int32
	upsertN  int32
	unlockN  int32
	listResp []domain.UserAchievement
	getResp  domain.UserAchievement
	getErr   error
}

func (s *stubRepo) Get(_ context.Context, _ uuid.UUID, _ string) (domain.UserAchievement, error) {
	return s.getResp, s.getErr
}
func (s *stubRepo) List(_ context.Context, _ uuid.UUID) ([]domain.UserAchievement, error) {
	atomic.AddInt32(&s.listN, 1)
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]domain.UserAchievement, len(s.listResp))
	copy(out, s.listResp)
	return out, nil
}
func (s *stubRepo) UpsertProgress(_ context.Context, uid uuid.UUID, code string, progress, target int) (domain.UserAchievement, bool, error) {
	atomic.AddInt32(&s.upsertN, 1)
	return domain.UserAchievement{UserID: uid, Code: code, Progress: progress, Target: target}, false, nil
}
func (s *stubRepo) Unlock(_ context.Context, uid uuid.UUID, code string, target int) (domain.UserAchievement, bool, error) {
	atomic.AddInt32(&s.unlockN, 1)
	return domain.UserAchievement{UserID: uid, Code: code, Progress: target, Target: target}, true, nil
}

func TestCachedRepo_List_HitMissAndInvalidate(t *testing.T) {
	ctx := context.Background()
	uid := uuid.New()
	stub := &stubRepo{listResp: []domain.UserAchievement{{UserID: uid, Code: "x", Target: 1}}}
	cache := NewCachedRepo(stub, newMemKV(), 1*time.Minute, testLog())

	// первый — miss → upstream
	if _, err := cache.List(ctx, uid); err != nil {
		t.Fatalf("first list: %v", err)
	}
	// второй — hit → НЕ должен дёрнуть upstream
	if _, err := cache.List(ctx, uid); err != nil {
		t.Fatalf("second list: %v", err)
	}
	if got := atomic.LoadInt32(&stub.listN); got != 1 {
		t.Fatalf("want 1 upstream call, got %d", got)
	}
	// invalidate через write-путь
	if _, _, err := cache.Unlock(ctx, uid, "x", 1); err != nil {
		t.Fatalf("unlock: %v", err)
	}
	if _, err := cache.List(ctx, uid); err != nil {
		t.Fatalf("third list: %v", err)
	}
	if got := atomic.LoadInt32(&stub.listN); got != 2 {
		t.Fatalf("want 2 upstream calls after invalidate, got %d", got)
	}
}

func TestCachedRepo_Singleflight_CollapsesConcurrentMisses(t *testing.T) {
	ctx := context.Background()
	uid := uuid.New()
	stub := &stubRepo{listResp: []domain.UserAchievement{{UserID: uid, Code: "x", Target: 1}}}
	// blocked KV — с долгой задержкой имитирует тяжёлый upstream.
	cache := NewCachedRepo(stub, newMemKV(), time.Minute, testLog())

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = cache.List(ctx, uid)
		}()
	}
	wg.Wait()
	// singleflight должен схлопнуть в <= несколько вызовов upstream.
	if got := atomic.LoadInt32(&stub.listN); got > 5 {
		t.Fatalf("singleflight failed: %d upstream calls", got)
	}
}
