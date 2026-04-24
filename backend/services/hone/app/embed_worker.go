package app

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// EmbedQueue — persistent очередь embedding-job'ов, поднята из goroutine
// (Phase 4) до Redis List (Phase 5b). Интерфейс здесь, реализация в infra
// — сохраняется domain→infra направление зависимости.
//
// Dequeue должен корректно реагировать на ctx.Done: возвращать либо
// ошибку ctx, либо context.DeadlineExceeded на idle-тиках (когда очередь
// пуста и blocking-read истёк). Worker оба случая обрабатывает как
// «пропустить итерацию», оставаясь ответственным за выход из цикла.
type EmbedQueue interface {
	Dequeue(ctx context.Context) (EmbedJobItem, error)
}

// EmbedJobItem — payload, получаемый воркером. Совпадает по форме с
// infra.EmbedJob (конвертер в monolith wiring'е).
type EmbedJobItem struct {
	UserID uuid.UUID
	NoteID uuid.UUID
	Text   string
}

// EmbedWorker — pool горутин, дрейнит очередь и персистит embedding'и
// через Embedder + NoteRepo.SetEmbedding.
//
// Идемпотентность: SetEmbedding — обычный UPDATE, повторный job для того
// же note-id перепишет вектор (nop, если текст тот же; корректный
// refresh, если заметка была обновлена). Это позволяет без страха
// ретраить failed job'ы — которые MVP-реализация пока не делает, но
// оставляет крючок в виде Log.Error и metrics-hook.
type EmbedWorker struct {
	Queue    EmbedQueue
	Embedder domain.Embedder
	Notes    domain.NoteRepo
	Log      *slog.Logger
	Now      func() time.Time

	// PoolSize — количество goroutine'ов. По умолчанию 2 — достаточно для
	// bge-small на Ollama (~50ms/запрос), больше упирается в Ollama GPU/CPU.
	PoolSize int
}

// Run запускает пул и блокируется до отмены ctx. Использовать через
// Module.Background — bootstrap сам вызовет Run в root-goroutine'е.
func (w *EmbedWorker) Run(ctx context.Context) {
	if w.PoolSize <= 0 {
		w.PoolSize = 2
	}
	var wg sync.WaitGroup
	wg.Add(w.PoolSize)
	for i := 0; i < w.PoolSize; i++ {
		go func(id int) {
			defer wg.Done()
			w.loop(ctx, id)
		}(i)
	}
	wg.Wait()
	if w.Log != nil {
		w.Log.Info("hone.embed.worker: drained")
	}
}

func (w *EmbedWorker) loop(ctx context.Context, id int) {
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		job, err := w.Queue.Dequeue(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			if errors.Is(err, context.DeadlineExceeded) {
				// Idle tick (BRPOP timeout). Не спим — следующая итерация
				// возвращается в Dequeue, который сам блокируется до 2с.
				continue
			}
			if w.Log != nil {
				w.Log.WarnContext(ctx, "hone.embed.worker: dequeue",
					slog.Int("worker", id), slog.Any("err", err))
			}
			// Медленный бэкоф, чтобы на падающем Redis не крутиться по 100% CPU.
			select {
			case <-ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
			continue
		}
		w.process(ctx, job)
	}
}

func (w *EmbedWorker) process(ctx context.Context, job EmbedJobItem) {
	if w.Embedder == nil || w.Notes == nil {
		// Без embedder'а job просто дропаем — значит OLLAMA_HOST не сконфигурен,
		// GetNoteConnections уже возвращает 503. Логируем на debug, без шума.
		if w.Log != nil {
			w.Log.Debug("hone.embed.worker: skipped (no embedder)",
				slog.String("note_id", job.NoteID.String()))
		}
		return
	}
	vec, model, err := w.Embedder.Embed(ctx, job.Text)
	if err != nil {
		if w.Log != nil {
			w.Log.Debug("hone.embed.worker: embed failed",
				slog.Any("err", err),
				slog.String("user_id", job.UserID.String()),
				slog.String("note_id", job.NoteID.String()))
		}
		return
	}
	at := time.Now().UTC()
	if w.Now != nil {
		at = w.Now().UTC()
	}
	if err := w.Notes.SetEmbedding(ctx, job.UserID, job.NoteID, vec, model, at); err != nil {
		if w.Log != nil {
			w.Log.Warn("hone.embed.worker: persist failed",
				slog.Any("err", err),
				slog.String("note_id", job.NoteID.String()))
		}
	}
}
