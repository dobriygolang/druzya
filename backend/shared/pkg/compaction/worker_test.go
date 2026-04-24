package compaction

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/shared/pkg/llmchain"
)

// fakeChat — in-memory реализация ChatClient для тестов.
type fakeChat struct {
	mu          sync.Mutex
	calls       int
	reply       string
	err         error
	delay       time.Duration
	onChatStart chan struct{} // optional barrier для backpressure-теста
	onChatWait  chan struct{}
}

func (f *fakeChat) Chat(ctx context.Context, req llmchain.Request) (llmchain.Response, error) {
	if f.onChatStart != nil {
		f.onChatStart <- struct{}{}
	}
	if f.onChatWait != nil {
		<-f.onChatWait
	}
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return llmchain.Response{}, ctx.Err()
		}
	}
	f.mu.Lock()
	f.calls++
	c := f.calls
	f.mu.Unlock()
	if f.err != nil {
		return llmchain.Response{}, f.err
	}
	reply := f.reply
	if reply == "" {
		reply = "summary #"
	}
	_ = c
	return llmchain.Response{Content: reply}, nil
}

func (f *fakeChat) ChatStream(_ context.Context, _ llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return nil, errors.New("stream not used")
}

type fakeStore struct {
	mu    sync.Mutex
	saves map[string]string
	err   error
}

func newFakeStore() *fakeStore { return &fakeStore{saves: map[string]string{}} }

func (s *fakeStore) Save(_ context.Context, key, summary string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	s.saves[key] = summary
	return nil
}

func (s *fakeStore) Get(key string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saves[key]
}

func (s *fakeStore) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.saves)
}

func testLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestWorker_ProcessesJob(t *testing.T) {
	chat := &fakeChat{reply: "new summary"}
	store := newFakeStore()
	w, err := NewWorker(chat, store, testLogger(), DefaultWorkerConfig())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Shutdown()

	if err := w.Submit(Job{SessionKey: "s1", OldTurns: []Turn{{Role: "user", Content: "hello"}}}); err != nil {
		t.Fatal(err)
	}

	// Ждём обработку.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if store.Get("s1") != "" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if store.Get("s1") != "new summary" {
		t.Fatalf("summary not saved, got %q", store.Get("s1"))
	}
	_, _, processed, _ := w.MetricsSnapshot()
	if processed != 1 {
		t.Fatalf("processed metric = %d, want 1", processed)
	}
}

func TestWorker_SubmitAfterShutdown(t *testing.T) {
	chat := &fakeChat{}
	store := newFakeStore()
	w, _ := NewWorker(chat, store, testLogger(), DefaultWorkerConfig())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	w.Shutdown()

	err := w.Submit(Job{SessionKey: "x"})
	if !errors.Is(err, ErrWorkerStopped) {
		t.Fatalf("expected ErrWorkerStopped, got %v", err)
	}
}

func TestWorker_ContextCancel(t *testing.T) {
	chat := &fakeChat{delay: 200 * time.Millisecond}
	store := newFakeStore()
	cfg := DefaultWorkerConfig()
	cfg.Workers = 1
	w, _ := NewWorker(chat, store, testLogger(), cfg)
	ctx, cancel := context.WithCancel(context.Background())
	w.Start(ctx)

	if err := w.Submit(Job{SessionKey: "s1", OldTurns: []Turn{{Content: "x"}}}); err != nil {
		t.Fatal(err)
	}
	// Отменяем до того как handler успеет сохранить.
	cancel()
	w.Shutdown()
	// Ничего не проверяем на счётчике — главное что Shutdown не виснет.
}

func TestWorker_DropOldestOnOverflow(t *testing.T) {
	// Настраиваем чат так, чтобы первый job блокировался до команды
	// waiters <- struct{}{}; пока worker стоит внутри Chat, буфер
	// наполняется и следующий Submit должен дропать старый.
	start := make(chan struct{}, 1)
	wait := make(chan struct{})
	chat := &fakeChat{onChatStart: start, onChatWait: wait}
	store := newFakeStore()
	cfg := WorkerConfig{Workers: 1, BufferSize: 1, Temperature: 0.2, MaxTokens: 32}
	w, _ := NewWorker(chat, store, testLogger(), cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)

	// 1-й Job попадает в worker (Chat висит).
	if err := w.Submit(Job{SessionKey: "a", OldTurns: []Turn{{Content: "a"}}}); err != nil {
		t.Fatal(err)
	}
	<-start // убедились что Chat реально стартовал
	// 2-й Job уходит в буфер (BufferSize=1).
	if err := w.Submit(Job{SessionKey: "b", OldTurns: []Turn{{Content: "b"}}}); err != nil {
		t.Fatal(err)
	}
	// 3-й Job должен дропнуть "b" и занять его место.
	if err := w.Submit(Job{SessionKey: "c", OldTurns: []Turn{{Content: "c"}}}); err != nil {
		t.Fatal(err)
	}

	_, dropped, _, _ := w.MetricsSnapshot()
	if dropped == 0 {
		t.Fatalf("expected at least 1 dropped job, got %d", dropped)
	}

	// Отпускаем worker, дожидаемся drain.
	close(wait)
	w.Shutdown()

	// "a" должен обработаться. "c" — тоже, потому что worker после a
	// пойдёт за следующим из буфера.
	if store.Get("a") == "" {
		t.Fatalf("session 'a' not saved")
	}
	if store.Get("b") != "" {
		t.Fatalf("session 'b' should have been dropped")
	}
}

func TestWorker_ChatErrorRecordsFailed(t *testing.T) {
	chat := &fakeChat{err: errors.New("provider down")}
	store := newFakeStore()
	w, _ := NewWorker(chat, store, testLogger(), DefaultWorkerConfig())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	w.Start(ctx)
	defer w.Shutdown()

	if err := w.Submit(Job{SessionKey: "s1", OldTurns: []Turn{{Content: "x"}}}); err != nil {
		t.Fatal(err)
	}
	// wait for metric
	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		_, _, _, failed := w.MetricsSnapshot()
		if failed > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	_, _, _, failed := w.MetricsSnapshot()
	if failed == 0 {
		t.Fatalf("expected failed counter > 0")
	}
}

func TestWorker_NilDepsRejected(t *testing.T) {
	if _, err := NewWorker(nil, newFakeStore(), testLogger(), DefaultWorkerConfig()); err == nil {
		t.Fatal("nil chat must error")
	}
	if _, err := NewWorker(&fakeChat{}, nil, testLogger(), DefaultWorkerConfig()); err == nil {
		t.Fatal("nil store must error")
	}
	if _, err := NewWorker(&fakeChat{}, newFakeStore(), nil, DefaultWorkerConfig()); err == nil {
		t.Fatal("nil log must error")
	}
}

// compile-time assertion: fakeChat реализует ChatClient.
var _ llmchain.ChatClient = (*fakeChat)(nil)
var _ = atomic.Int64{}
