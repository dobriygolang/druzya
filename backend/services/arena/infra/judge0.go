package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/arena/domain"
)

// FakeJudge0 — подставной клиент, который «проходит» каждую отправку после
// небольшой искусственной задержки. Нужен, чтобы arena-домен мог подключить
// async-worker, а end-to-end happy path тестировался без Judge0.
//
// STUB: настоящий клиент Judge0 живёт в отдельном пакете (план: druz9/infra/judge0).
// Он будет:
//   - POST /submissions?wait=true с base64 source + stdin
//   - polling статуса, если wait=false
//   - маппинг status-кодов Judge0 в (passed, total, passed_count, runtime_ms, memory_kb)
type FakeJudge0 struct {
	// Delay имитирует задержку грейдера, чтобы прогонялся async-worker.
	Delay time.Duration
}

// NewFakeJudge0 возвращает stub с искусственной задержкой 200мс.
func NewFakeJudge0() *FakeJudge0 {
	return &FakeJudge0{Delay: 200 * time.Millisecond}
}

// Submit — stub-реализация: всегда «проходит» с 1/1 тестов.
func (f *FakeJudge0) Submit(ctx context.Context, _ string, _ string, _ domain.TaskPublic) (domain.Judge0Result, error) {
	if f.Delay > 0 {
		select {
		case <-time.After(f.Delay):
		case <-ctx.Done():
			return domain.Judge0Result{}, fmt.Errorf("arena.judge0.Submit: ctx cancelled: %w", ctx.Err())
		}
	}
	return domain.Judge0Result{
		Passed:      true,
		TestsTotal:  1,
		TestsPassed: 1,
		RuntimeMs:   42,
		MemoryKB:    1024,
	}, nil
}

// Interface guard — проверка соответствия интерфейсу.
var _ domain.Judge0Client = (*FakeJudge0)(nil)
