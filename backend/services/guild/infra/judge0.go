package infra

import (
	"context"
	"time"

	"druz9/guild/domain"
	"druz9/shared/enums"
)

// FakeJudge0 is a stand-in client that "passes" every contribution after a
// short artificial delay. It lets the guild domain compile and be exercised
// end-to-end without a real grader.
//
// STUB: real Judge0 client lives in its own package (planned: druz9/infra/judge0).
// The real client will:
//   - POST /submissions?wait=true with base64 source + stdin
//   - poll for status if wait=false
//   - map Judge0 status codes to (passed, total, passed_count, runtime_ms, memory_kb)
type FakeJudge0 struct {
	// Delay simulates the grader latency so any async worker is exercised.
	Delay time.Duration
	// Score is the contribution score assigned on a pass. Defaults to 10 to
	// give war tallies something non-trivial to add up.
	Score int
}

// NewFakeJudge0 returns a stub with 100ms delay and score=10.
func NewFakeJudge0() *FakeJudge0 {
	return &FakeJudge0{Delay: 100 * time.Millisecond, Score: 10}
}

// Submit returns a successful grade. The Score field is not part of the
// Judge0Result contract (each domain decides how to convert passed → score),
// so the guild use case multiplies tests passed by 10 by default.
func (f *FakeJudge0) Submit(ctx context.Context, _ string, _ string, _ enums.Section) (domain.Judge0Result, error) {
	if f.Delay > 0 {
		select {
		case <-time.After(f.Delay):
		case <-ctx.Done():
			return domain.Judge0Result{}, ctx.Err()
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
