package compaction

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"

	"druz9/shared/pkg/llmchain"
)

// Job — одна задача на фоновую суммаризацию. SessionKey — opaque идентификатор
// (string), чтобы пакет не зависел ни от uuid ни от типа конкретной таблицы.
// Вызывающий слой (copilot/ai_mock) кодирует свой ID в строку и декодирует
// обратно в Store.Save.
type Job struct {
	// SessionKey — идентификатор сессии/разговора в opaque форме.
	SessionKey string
	// PrevSummary — текущий running_summary, если был. Будет использован
	// как "пролог" в промпт суммаризатора (incremental summary).
	PrevSummary string
	// OldTurns — turns, которые нужно свернуть в summary (из BuildWindow.OldTurns).
	OldTurns []Turn
}

// SummaryStore — интерфейс persistent-слоя. Вызывается воркером после
// успешной суммаризации. Реализация живёт в сервисе (copilot/infra,
// ai_mock/infra).
type SummaryStore interface {
	// Save атомарно записывает новый running_summary для sessionKey.
	// Ошибки пробрасываются вверх — воркер логирует и продолжает.
	Save(ctx context.Context, sessionKey, summary string) error
}

// WorkerConfig — параметры фона.
type WorkerConfig struct {
	// Workers — сколько goroutines обрабатывают канал. Default 2.
	Workers int
	// BufferSize — размер bounded-канала. При overflow → drop-oldest.
	// Default 64.
	BufferSize int
	// Temperature / MaxTokens — параметры LLM-запроса на суммаризацию.
	// Нули → дефолты (0.2, 512).
	Temperature float64
	MaxTokens   int
}

// DefaultWorkerConfig — безопасные значения.
func DefaultWorkerConfig() WorkerConfig {
	return WorkerConfig{Workers: 2, BufferSize: 64, Temperature: 0.2, MaxTokens: 512}
}

// Metrics — счётчики воркера. Экспортируются наружу через атомарные
// геттеры — удобно для тестов и прометей-bridge (оставим его на уровне
// wirer'а, пакет metrics-agnostic).
type Metrics struct {
	Submitted atomic.Int64
	Dropped   atomic.Int64
	Processed atomic.Int64
	Failed    atomic.Int64
}

// Worker — пул горутин, принимающий Job'ы и пишущий running_summary
// через Store.
//
// Lifecycle:
//
//	w := NewWorker(chat, store, log, DefaultWorkerConfig())
//	w.Start(ctx)   // невозвратная в фоне; context cancel -> graceful stop
//	w.Submit(job)  // non-blocking; при переполнении теряем самый старый
//	w.Shutdown()   // drain остатка + join goroutines
type Worker struct {
	chat    llmchain.ChatClient
	store   SummaryStore
	log     *slog.Logger
	cfg     WorkerConfig
	metrics Metrics

	mu      sync.Mutex
	jobs    chan Job
	stopped atomic.Bool
	wg      sync.WaitGroup
}

// NewWorker — конструктор. chat/store/log обязательны (anti-fallback).
func NewWorker(chat llmchain.ChatClient, store SummaryStore, log *slog.Logger, cfg WorkerConfig) (*Worker, error) {
	if chat == nil {
		return nil, fmt.Errorf("compaction.NewWorker: chat client is required")
	}
	if store == nil {
		return nil, fmt.Errorf("compaction.NewWorker: summary store is required")
	}
	if log == nil {
		return nil, fmt.Errorf("compaction.NewWorker: logger is required")
	}
	if cfg.Workers <= 0 {
		cfg.Workers = 2
	}
	if cfg.BufferSize <= 0 {
		cfg.BufferSize = 64
	}
	if cfg.Temperature <= 0 {
		cfg.Temperature = 0.2
	}
	if cfg.MaxTokens <= 0 {
		cfg.MaxTokens = 512
	}
	return &Worker{
		chat:  chat,
		store: store,
		log:   log,
		cfg:   cfg,
		jobs:  make(chan Job, cfg.BufferSize),
	}, nil
}

// Start — запускает worker goroutines. Возвращает сразу. Повторный вызов
// — no-op.
func (w *Worker) Start(ctx context.Context) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.stopped.Load() {
		return
	}
	for i := 0; i < w.cfg.Workers; i++ {
		w.wg.Add(1)
		go w.loop(ctx)
	}
}

// MetricsSnapshot — тест-френдли доступ к счётчикам.
func (w *Worker) MetricsSnapshot() (submitted, dropped, processed, failed int64) {
	return w.metrics.Submitted.Load(),
		w.metrics.Dropped.Load(),
		w.metrics.Processed.Load(),
		w.metrics.Failed.Load()
}

// Submit — non-blocking отправка Job. При переполнении буфера
// выбрасывает САМЫЙ СТАРЫЙ элемент канала (drop-oldest) и ставит
// новый. Рационал: свежая сумма важнее старой — если воркеры не
// успевают, лучше потерять устаревший срез истории.
//
// Возвращает ErrWorkerStopped если Shutdown уже был вызван.
func (w *Worker) Submit(j Job) error {
	if w.stopped.Load() {
		return ErrWorkerStopped
	}
	w.metrics.Submitted.Add(1)
	select {
	case w.jobs <- j:
		return nil
	default:
		// Канал полон. Drop-oldest: быстро читаем один элемент, кладём
		// новый. Между чтением и записью канал всё ещё может быть полон
		// (другой writer успел) — тогда просто теряем текущий.
		select {
		case <-w.jobs:
			w.metrics.Dropped.Add(1)
			w.log.Warn("compaction.Worker: dropped oldest job (buffer full)",
				slog.String("session_key", j.SessionKey),
				slog.Int("buffer_size", w.cfg.BufferSize))
		default:
		}
		select {
		case w.jobs <- j:
			return nil
		default:
			w.metrics.Dropped.Add(1)
			w.log.Warn("compaction.Worker: dropped new job (buffer saturated)",
				slog.String("session_key", j.SessionKey))
			return nil
		}
	}
}

// Shutdown — закрывает канал и ждёт завершения всех воркеров. После
// вызова Submit вернёт ErrWorkerStopped. Безопасен при повторном вызове.
func (w *Worker) Shutdown() {
	if !w.stopped.CompareAndSwap(false, true) {
		return
	}
	close(w.jobs)
	w.wg.Wait()
}

func (w *Worker) loop(ctx context.Context) {
	defer w.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case j, ok := <-w.jobs:
			if !ok {
				return
			}
			w.handle(ctx, j)
		}
	}
}

func (w *Worker) handle(ctx context.Context, j Job) {
	if ctx.Err() != nil {
		return
	}
	prompt := buildSummaryPrompt(j.PrevSummary, j.OldTurns)
	resp, err := w.chat.Chat(ctx, llmchain.Request{
		Task: llmchain.TaskSummarize,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: summarizerSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
		Temperature: w.cfg.Temperature,
		MaxTokens:   w.cfg.MaxTokens,
	})
	if err != nil {
		w.metrics.Failed.Add(1)
		w.log.Warn("compaction.Worker: summarize failed",
			slog.String("session_key", j.SessionKey),
			slog.Any("err", err))
		return
	}
	newSummary := strings.TrimSpace(resp.Content)
	if newSummary == "" {
		w.metrics.Failed.Add(1)
		w.log.Warn("compaction.Worker: empty summary returned",
			slog.String("session_key", j.SessionKey))
		return
	}
	if err := w.store.Save(ctx, j.SessionKey, newSummary); err != nil {
		w.metrics.Failed.Add(1)
		w.log.Warn("compaction.Worker: store save failed",
			slog.String("session_key", j.SessionKey),
			slog.Any("err", err))
		return
	}
	w.metrics.Processed.Add(1)
}

const summarizerSystemPrompt = `Ты — суммаризатор истории диалога между пользователем и ассистентом.
Твоя задача: сжать переданную историю в короткий (<= 200 слов) конспект на русском.
Сохрани: ключевые решения, озвученные требования, упомянутые технологии/подходы, открытые вопросы.
НЕ добавляй ничего от себя, НЕ интерпретируй — только пересказывай факты из истории.
Если был предыдущий running_summary — включи его фактуру в новую версию (incremental).
Верни ТОЛЬКО текст конспекта, без заголовков и markdown.`

func buildSummaryPrompt(prev string, turns []Turn) string {
	var b strings.Builder
	if strings.TrimSpace(prev) != "" {
		b.WriteString("Предыдущий конспект:\n")
		b.WriteString(prev)
		b.WriteString("\n\n")
	}
	b.WriteString("История для сжатия:\n")
	for _, t := range turns {
		b.WriteString(t.Role)
		b.WriteString(": ")
		b.WriteString(t.Content)
		b.WriteString("\n")
	}
	return b.String()
}
