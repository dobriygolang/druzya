package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/arena/domain"
)

// FakeJudge0 is a stand-in client that "passes" every submission after a short
// artificial delay. It exists so the arena domain can wire an async worker and
// the end-to-end happy path is testable without Judge0.
//
// STUB: real Judge0 client lives in its own package (planned: druz9/infra/judge0).
// That client will:
//   - POST /submissions?wait=true with base64 source + stdin
//   - poll for status if wait=false
//   - map Judge0 status codes to (passed, total, passed_count, runtime_ms, memory_kb)
type FakeJudge0 struct {
	// Delay simulates the grader latency so the async worker is exercised.
	Delay time.Duration
}

// NewFakeJudge0 returns a stub with a 200ms artificial delay.
func NewFakeJudge0() *FakeJudge0 {
	return &FakeJudge0{Delay: 200 * time.Millisecond}
}

// Submit is the stub implementation — always passes with 1/1 tests.
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

// Interface guard.
var _ domain.Judge0Client = (*FakeJudge0)(nil)
