package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// ReportWorker is a fixed-size goroutine pool that runs report-generation jobs
// in the background. Jobs arrive on a buffered channel from FinishSession.Enqueue.
//
// STUB: production wiring should live behind asynq (bible mentions it) once the
// shared package lands. The in-process pool is fine for MVP and collapses down
// to a single worker in tests.
type ReportWorker struct {
	jobs chan uuid.UUID
	wg   sync.WaitGroup
	log  *slog.Logger

	Sessions domain.SessionRepo
	Messages domain.MessageRepo
	Tasks    domain.TaskRepo
	LLM      domain.LLMProvider
	Replay   domain.ReplayUploader

	// ReportModel is the model used for the grading call. Falls back to the
	// session's model if empty.
	ReportModel string
}

// NewReportWorker builds a worker with `size` goroutines. queueSize is the
// buffered job queue size (0 falls back to 32).
func NewReportWorker(_, queueSize int, log *slog.Logger) *ReportWorker {
	if queueSize <= 0 {
		queueSize = 32
	}
	return &ReportWorker{
		jobs: make(chan uuid.UUID, queueSize),
		log:  log,
	}
}

// Start spawns workers that run until ctx is cancelled. Caller must invoke
// Wait after cancellation to drain.
func (w *ReportWorker) Start(ctx context.Context) {
	for i := 0; i < cap(w.jobs)/16+1; i++ { // 1 worker per 16 queued jobs, min 1
		w.wg.Add(1)
		go w.loop(ctx)
	}
}

// Enqueue submits a session id for report generation. Drops the job with a log
// if the queue is full — caller can retry via manual endpoint later.
func (w *ReportWorker) Enqueue(sessionID uuid.UUID) {
	select {
	case w.jobs <- sessionID:
	default:
		if w.log != nil {
			w.log.Warn("mock.ReportWorker: queue full, dropping job", slog.String("session", sessionID.String()))
		}
	}
}

// Wait blocks until the loop goroutines exit (triggered by ctx cancellation).
func (w *ReportWorker) Wait() { w.wg.Wait() }

// Close stops accepting new jobs and drains the queue.
func (w *ReportWorker) Close() { close(w.jobs) }

func (w *ReportWorker) loop(ctx context.Context) {
	defer w.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case id, ok := <-w.jobs:
			if !ok {
				return
			}
			if err := w.run(ctx, id); err != nil {
				if w.log != nil {
					w.log.Error("mock.ReportWorker: job failed", slog.String("session", id.String()), slog.Any("err", err))
				}
			}
		}
	}
}

func (w *ReportWorker) run(ctx context.Context, sessionID uuid.UUID) error {
	s, err := w.Sessions.Get(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("load session: %w", err)
	}
	task, err := w.Tasks.GetWithHint(ctx, s.TaskID)
	if err != nil {
		return fmt.Errorf("load task: %w", err)
	}
	msgs, err := w.Messages.ListAll(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("load messages: %w", err)
	}

	sys := domain.BuildReportPrompt(s, task, s.Stress)
	prompt := []domain.LLMMessage{{Role: domain.LLMRoleSystem, Content: sys}}
	prompt = append(prompt, domain.ToLLMMessages(msgs, 0)...)

	model := w.ReportModel
	if model == "" {
		model = s.LLMModel.String()
	}

	resp, err := w.LLM.Complete(ctx, domain.CompletionRequest{
		Model:       model,
		Messages:    prompt,
		Temperature: 0.2, // more deterministic for grading
		MaxTokens:   2048,
	})
	if err != nil {
		return fmt.Errorf("llm: %w", err)
	}

	draft, err := ParseReportJSON(resp.Content)
	if err != nil {
		return fmt.Errorf("parse: %w", err)
	}

	// STUB: optional replay upload. The serialised shape is just the message
	// transcript for now; future work should capture editor timeline + AV.
	var replayURL string
	if w.Replay != nil {
		payload, _ := json.Marshal(msgs)
		if url, uerr := w.Replay.Upload(ctx, sessionID, payload); uerr == nil {
			replayURL = url
			draft.ReplayURL = url
		}
	}

	blob, err := json.Marshal(draft)
	if err != nil {
		return fmt.Errorf("marshal draft: %w", err)
	}
	if err := w.Sessions.UpdateReport(ctx, sessionID, blob, replayURL); err != nil {
		return fmt.Errorf("persist: %w", err)
	}
	return nil
}
