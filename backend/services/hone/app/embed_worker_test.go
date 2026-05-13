package app

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	honeDomain "druz9/hone/domain"
	honeMocks "druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ─── queueState + wireMockEmbedQueue ──────────────────────────────────────
//
// queueState — закрытая state-машина для EmbedQueue: items живут в slice,
// Dequeue возвращает FIFO. Idle behavior (когда items пуст) emulates
// blocking-read с таймаутом 10ms — это нужно тестам, проверяющим, что
// воркер не зависает.

type queueState struct {
	mu    sync.Mutex
	items []EmbedJobItem
	calls int32
}

func (q *queueState) push(item EmbedJobItem) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.items = append(q.items, item)
}

func wireMockEmbedQueue(ctrl *gomock.Controller, q *queueState) *MockEmbedQueue {
	m := NewMockEmbedQueue(ctrl)
	m.EXPECT().Dequeue(gomock.Any()).DoAndReturn(
		func(ctx context.Context) (EmbedJobItem, error) {
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
		},
	).AnyTimes()
	return m
}

// embedderState — фиксированный вектор + счётчик вызовов.
type embedderState struct {
	vec   []float32
	model string
	calls int32
}

func wireMockEmbedder(ctrl *gomock.Controller, s *embedderState) *honeMocks.MockEmbedder {
	m := honeMocks.NewMockEmbedder(ctrl)
	m.EXPECT().Embed(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ string) ([]float32, string, error) {
			atomic.AddInt32(&s.calls, 1)
			return s.vec, s.model, nil
		},
	).AnyTimes()
	return m
}

// notesEmbedState — для NotesRepo subset, который использует worker:
// только SetEmbedding (остальные методы — заглушки через AnyTimes).
type notesEmbedState struct {
	mu      sync.Mutex
	setCall int32
	gotVec  []float32
}

func wireMockNoteRepoForEmbed(ctrl *gomock.Controller, s *notesEmbedState) *honeMocks.MockNoteRepo {
	m := honeMocks.NewMockNoteRepo(ctrl)
	m.EXPECT().SetEmbedding(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ uuid.UUID, vec []float32, _ string, _ time.Time) error {
			atomic.AddInt32(&s.setCall, 1)
			s.mu.Lock()
			defer s.mu.Unlock()
			s.gotVec = vec
			return nil
		},
	).AnyTimes()
	// Остальные методы NoteRepo воркером не используются — отвечаем дефолтами AnyTimes.
	m.EXPECT().Create(gomock.Any(), gomock.Any()).Return(honeDomain.Note{}, nil).AnyTimes()
	m.EXPECT().Update(gomock.Any(), gomock.Any()).Return(honeDomain.Note{}, nil).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any(), gomock.Any()).Return(honeDomain.Note{}, nil).AnyTimes()
	m.EXPECT().List(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, "", nil).AnyTimes()
	m.EXPECT().Move(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(honeDomain.Note{}, nil).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().WithEmbeddingsForUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().ExistsByTitleForUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(false, nil).AnyTimes()
	m.EXPECT().MarkStaleForReembed(gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	m.EXPECT().SearchSimilarNotes(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

// ─── tests ─────────────────────────────────────────────────────────────────

func TestEmbedWorker_ProcessesJob(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)

	q := &queueState{}
	emb := &embedderState{vec: []float32{0.1, 0.2, 0.3}, model: "bge-small-test"}
	repo := &notesEmbedState{}
	q.push(EmbedJobItem{UserID: uuid.New(), NoteID: uuid.New(), Text: "hello"})

	w := &EmbedWorker{
		Queue:    wireMockEmbedQueue(ctrl, q),
		Embedder: wireMockEmbedder(ctrl, emb),
		Notes:    wireMockNoteRepoForEmbed(ctrl, repo),
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
	ctrl := gomock.NewController(t)
	w := &EmbedWorker{
		Queue:    wireMockEmbedQueue(ctrl, &queueState{}),
		Embedder: wireMockEmbedder(ctrl, &embedderState{}),
		Notes:    wireMockNoteRepoForEmbed(ctrl, &notesEmbedState{}),
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
