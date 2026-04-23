package infra

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"druz9/profile/app"

	"github.com/google/uuid"
)

// stubLoader counts calls and returns a fixed view (or err).
type stubLoader struct {
	calls atomic.Int64
	view  app.ReportView
	err   error
}

func (s *stubLoader) load(_ context.Context, _ uuid.UUID, _ time.Time) (app.ReportView, error) {
	s.calls.Add(1)
	return s.view, s.err
}

func TestReportCache_HitSecondCall(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	loader := &stubLoader{view: app.ReportView{StreakDays: 7, BestStreak: 12}}
	kv := newMemKV()
	rc := NewReportCache(loader.load, kv, time.Minute, testLog())

	if _, err := rc.Get(context.Background(), uid); err != nil {
		t.Fatalf("first call: %v", err)
	}
	got, err := rc.Get(context.Background(), uid)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if got.StreakDays != 7 {
		t.Fatalf("streak mismatch: %d", got.StreakDays)
	}
	if loader.calls.Load() != 1 {
		t.Fatalf("loader should be called once, got %d", loader.calls.Load())
	}
}

func TestReportCache_MissTriggersLoader(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	loader := &stubLoader{view: app.ReportView{ActionsCount: 47}}
	kv := newMemKV()
	rc := NewReportCache(loader.load, kv, time.Minute, testLog())

	got, err := rc.Get(context.Background(), uid)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got.ActionsCount != 47 {
		t.Fatalf("actions=%d", got.ActionsCount)
	}
	if loader.calls.Load() != 1 {
		t.Fatalf("expected 1 loader call, got %d", loader.calls.Load())
	}
}

func TestReportCache_LoaderErrorPropagated(t *testing.T) {
	t.Parallel()
	loader := &stubLoader{err: errors.New("boom")}
	rc := NewReportCache(loader.load, newMemKV(), time.Minute, testLog())
	_, err := rc.Get(context.Background(), uuid.New())
	if err == nil || !errors.Is(err, loader.err) {
		t.Fatalf("expected wrapped boom, got %v", err)
	}
}

func TestReportCache_RedisGetErrorPropagates(t *testing.T) {
	t.Parallel()
	// fallbacks were removed deliberately — Redis is required, errors propagate.
	// Loader MUST NOT be invoked when Redis Get itself blew up.
	loader := &stubLoader{view: app.ReportView{StreakDays: 3}}
	kv := newMemKV()
	kv.failGet = true
	rc := NewReportCache(loader.load, kv, time.Minute, testLog())
	if _, err := rc.Get(context.Background(), uuid.New()); err == nil {
		t.Fatalf("expected error when Redis Get fails, got nil")
	}
	if loader.calls.Load() != 0 {
		t.Fatalf("loader should not be invoked when Redis Get failed, calls=%d", loader.calls.Load())
	}
}

func TestReportCache_InvalidateBustsKey(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	loader := &stubLoader{view: app.ReportView{ActionsCount: 1}}
	kv := newMemKV()
	rc := NewReportCache(loader.load, kv, time.Minute, testLog())
	_, _ = rc.Get(context.Background(), uid)
	rc.Invalidate(context.Background(), uid)
	if _, err := rc.Get(context.Background(), uid); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if loader.calls.Load() != 2 {
		t.Fatalf("expected loader call after invalidate, calls=%d", loader.calls.Load())
	}
}

func TestReportCache_TTLExpiry(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	loader := &stubLoader{view: app.ReportView{ActionsCount: 9}}
	kv := newMemKV()
	now := time.Now()
	kv.now = func() time.Time { return now }
	rc := NewReportCache(loader.load, kv, time.Second, testLog())
	if _, err := rc.Get(context.Background(), uid); err != nil {
		t.Fatalf("first: %v", err)
	}
	now = now.Add(2 * time.Second)
	if _, err := rc.Get(context.Background(), uid); err != nil {
		t.Fatalf("after TTL: %v", err)
	}
	if loader.calls.Load() != 2 {
		t.Fatalf("expected 2 loader calls after TTL, got %d", loader.calls.Load())
	}
}

func TestReportCache_NilLogPanics(t *testing.T) {
	t.Parallel()
	// anti-fallback: nil logger must panic at construction (see NewReportCache).
	defer func() {
		if recover() == nil {
			t.Fatalf("expected panic on nil logger")
		}
	}()
	_ = NewReportCache(func(_ context.Context, _ uuid.UUID, _ time.Time) (app.ReportView, error) {
		return app.ReportView{}, nil
	}, newMemKV(), 0, nil)
}

func TestReportCache_DefaultTTLApplied(t *testing.T) {
	t.Parallel()
	rc := NewReportCache(func(_ context.Context, _ uuid.UUID, _ time.Time) (app.ReportView, error) {
		return app.ReportView{}, nil
	}, newMemKV(), 0, testLog())
	if rc.ttl != DefaultReportCacheTTL {
		t.Fatalf("expected default TTL, got %v", rc.ttl)
	}
}

func TestReportCache_CorruptEntryRefreshes(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	loader := &stubLoader{view: app.ReportView{ActionsCount: 5}}
	kv := newMemKV()
	rc := NewReportCache(loader.load, kv, time.Minute, testLog())
	// Inject corrupt JSON under the report key.
	_ = kv.Set(context.Background(), reportKey(uid), []byte("not-json{"), time.Minute)
	got, err := rc.Get(context.Background(), uid)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got.ActionsCount != 5 {
		t.Fatalf("expected fresh load, got actions=%d", got.ActionsCount)
	}
}
