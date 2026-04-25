package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── fakes ─────────────────────────────────────────────────────────────────

type fakeQueue struct {
	mu    sync.Mutex
	items []EmbedJobItem
	calls int32
}

func (q *fakeQueue) push(item EmbedJobItem) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.items = append(q.items, item)
}

func (q *fakeQueue) Dequeue(ctx context.Context) (EmbedJobItem, error) {
	atomic.AddInt32(&q.calls, 1)
	q.mu.Lock()
	if len(q.items) > 0 {
		it := q.items[0]
		q.items = q.items[1:]
		q.mu.Unlock()
		return it, nil
	}
	q.mu.Unlock()
	// idle tick
	select {
	case <-ctx.Done():
		return EmbedJobItem{}, ctx.Err()
	case <-time.After(10 * time.Millisecond):
		return EmbedJobItem{}, context.DeadlineExceeded
	}
}

type fakeEmbedder struct {
	vec   []float32
	model string
	err   error
	calls int32
}

func (f *fakeEmbedder) Embed(_ context.Context, _ string) ([]float32, string, error) {
	atomic.AddInt32(&f.calls, 1)
	return f.vec, f.model, f.err
}

type fakeNotesRepo struct {
	mu      sync.Mutex
	setCall int32
	gotVec  []float32
	setErr  error
}

func (r *fakeNotesRepo) SetEmbedding(_ context.Context, _, _ uuid.UUID, vec []float32, _ string, _ time.Time) error {
	atomic.AddInt32(&r.setCall, 1)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.gotVec = vec
	return r.setErr
}

// Только SetEmbedding задействован воркером — остальные методы можно
// оставить unimplemented.
func (r *fakeNotesRepo) Create(context.Context, domain.Note) (domain.Note, error) {
	return domain.Note{}, errors.New("unused")
}
func (r *fakeNotesRepo) Update(context.Context, domain.Note) (domain.Note, error) {
	return domain.Note{}, errors.New("unused")
}
func (r *fakeNotesRepo) Get(context.Context, uuid.UUID, uuid.UUID) (domain.Note, error) {
	return domain.Note{}, errors.New("unused")
}
func (r *fakeNotesRepo) List(context.Context, uuid.UUID, int, string) ([]domain.NoteSummary, string, error) {
	return nil, "", errors.New("unused")
}
func (r *fakeNotesRepo) Delete(context.Context, uuid.UUID, uuid.UUID) error {
	return errors.New("unused")
}
func (r *fakeNotesRepo) SetArchived(context.Context, uuid.UUID, uuid.UUID, bool) error {
	return errors.New("unused")
}
func (r *fakeNotesRepo) WithEmbeddingsForUser(context.Context, uuid.UUID) ([]domain.NoteEmbedding, error) {
	return nil, errors.New("unused")
}

func (r *fakeNotesRepo) ExistsByTitleForUser(context.Context, uuid.UUID, string) (bool, error) {
	return false, nil
}

// ─── tests ─────────────────────────────────────────────────────────────────

func TestEmbedWorker_ProcessesJob(t *testing.T) {
	t.Parallel()

	q := &fakeQueue{}
	emb := &fakeEmbedder{vec: []float32{0.1, 0.2, 0.3}, model: "bge-small-test"}
	repo := &fakeNotesRepo{}
	q.push(EmbedJobItem{UserID: uuid.New(), NoteID: uuid.New(), Text: "hello"})

	w := &EmbedWorker{
		Queue:    q,
		Embedder: emb,
		Notes:    repo,
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		PoolSize: 1,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	done := make(chan struct{})
	go func() {
		w.Run(ctx)
		close(done)
	}()

	// Ждём одного SetEmbedding + даём воркеру корректно завершиться.
	deadline := time.After(300 * time.Millisecond)
	for {
		if atomic.LoadInt32(&repo.setCall) >= 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("SetEmbedding not called within deadline (embed calls=%d dequeue=%d)",
				atomic.LoadInt32(&emb.calls), atomic.LoadInt32(&q.calls))
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	<-done

	if got := atomic.LoadInt32(&emb.calls); got != 1 {
		t.Errorf("embedder.Embed calls = %d, want 1", got)
	}
	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.gotVec) != 3 || repo.gotVec[0] != 0.1 {
		t.Errorf("SetEmbedding received wrong vector: %v", repo.gotVec)
	}
}

func TestEmbedWorker_ExitsOnCancel(t *testing.T) {
	t.Parallel()
	w := &EmbedWorker{
		Queue:    &fakeQueue{},
		Embedder: &fakeEmbedder{},
		Notes:    &fakeNotesRepo{},
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		PoolSize: 2,
	}
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()

	cancel()
	select {
	case <-done:
	case <-time.After(1 * time.Second):
		t.Fatalf("worker did not exit after ctx cancel")
	}
}
