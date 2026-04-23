package ports

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// fakeSync — счётчик RunOnce-вызовов; имитирует app.SyncJob без реальных
// парсеров.
type fakeSync struct {
	calls int32
	delay time.Duration
}

func (f *fakeSync) RunOnce(_ context.Context) {
	atomic.AddInt32(&f.calls, 1)
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
}

func TestHandleSync_FirstCallStarts(t *testing.T) {
	t.Parallel()
	fs := &fakeSync{}
	h := &Handler{Sync: fs, SyncCooldown: 50 * time.Millisecond}

	req := httptest.NewRequest(http.MethodPost, "/vacancies/sync", nil)
	rec := httptest.NewRecorder()
	h.handleSync(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	var body syncResp
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "started" {
		t.Errorf("status = %q, want started", body.Status)
	}
	// Дать горутине шанс выполнить RunOnce.
	time.Sleep(20 * time.Millisecond)
	if got := atomic.LoadInt32(&fs.calls); got != 1 {
		t.Errorf("RunOnce calls = %d, want 1", got)
	}
}

func TestHandleSync_ThrottledOnQuickSecondCall(t *testing.T) {
	t.Parallel()
	fs := &fakeSync{}
	h := &Handler{Sync: fs, SyncCooldown: 5 * time.Second}
	// Симулируем недавний sync.
	h.lastSyncedAt = time.Now()

	req := httptest.NewRequest(http.MethodPost, "/vacancies/sync", nil)
	rec := httptest.NewRecorder()
	h.handleSync(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Errorf("Retry-After header missing")
	}
	var body syncResp
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "throttled" {
		t.Errorf("status = %q, want throttled", body.Status)
	}
	if body.RetryAfter <= 0 {
		t.Errorf("retry_after = %d, want > 0", body.RetryAfter)
	}
	if got := atomic.LoadInt32(&fs.calls); got != 0 {
		t.Errorf("RunOnce should not have been called, got %d", got)
	}
}

func TestHandleSync_AlreadyRunning(t *testing.T) {
	t.Parallel()
	fs := &fakeSync{delay: 200 * time.Millisecond}
	h := &Handler{Sync: fs, SyncCooldown: 1 * time.Millisecond}

	// Первый запрос запускает фоновый sync.
	rec1 := httptest.NewRecorder()
	h.handleSync(rec1, httptest.NewRequest(http.MethodPost, "/vacancies/sync", nil))
	if rec1.Code != http.StatusAccepted {
		t.Fatalf("first call status = %d, want 202", rec1.Code)
	}
	// Сразу второй — должен ответить already_running, потому что предыдущий
	// ещё спит в delay.
	rec2 := httptest.NewRecorder()
	h.handleSync(rec2, httptest.NewRequest(http.MethodPost, "/vacancies/sync", nil))
	var body syncResp
	if err := json.Unmarshal(rec2.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "already_running" {
		t.Errorf("status = %q, want already_running", body.Status)
	}
	// Подождать завершения, чтобы не оставить горутину висящей.
	time.Sleep(300 * time.Millisecond)
}

func TestHandleSync_NoRunnerWired(t *testing.T) {
	t.Parallel()
	h := &Handler{}
	rec := httptest.NewRecorder()
	h.handleSync(rec, httptest.NewRequest(http.MethodPost, "/vacancies/sync", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}
