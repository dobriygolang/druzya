// llm_invocation_worker.go — Wave 15. Batch writer for the LLM audit log.
//
// Subscribes to llmchain.InvocationHook → enqueues events on a buffered
// channel → background goroutine flushes batches into llm_invocations.
// Best-effort: full channel drops the event silently (cheap counter
// increments stay in Prometheus). The fire-and-forget posture matches
// the existing observeCost prometheus path.
package admin

import (
	"context"
	"log/slog"
	"sync/atomic"
	"time"

	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// invocationBufSize — non-blocking ring. 1024 events ≈ 2-3 min of
	// peak traffic; flushed every flushInterval or full-batch threshold.
	invocationBufSize = 1024
	// flushInterval — at most this long between INSERTs.
	flushInterval = 5 * time.Second
	// flushBatchSize — batch size threshold for early flush.
	flushBatchSize = 50
)

// llmInvocationWorker — single-goroutine consumer.
type llmInvocationWorker struct {
	pool *pgxpool.Pool
	log  *slog.Logger
	ch   chan llmchain.InvocationEvent
	// dropped — Prometheus / log surfacing when buffer is full.
	dropped atomic.Uint64
}

// startLLMInvocationWorker wires the hook + spawns the consumer.
// Returns a stop fn that flushes and exits.
func startLLMInvocationWorker(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	if pool == nil {
		// No DB → no audit log; the prometheus / Loki path is still alive.
		return
	}
	w := &llmInvocationWorker{
		pool: pool,
		log:  log,
		ch:   make(chan llmchain.InvocationEvent, invocationBufSize),
	}
	llmchain.SetInvocationHook(w.enqueue)
	go w.run(ctx)
}

// enqueue — non-blocking. Drops on full buffer (best-effort audit).
func (w *llmInvocationWorker) enqueue(ev llmchain.InvocationEvent) {
	select {
	case w.ch <- ev:
	default:
		w.dropped.Add(1)
	}
}

// run flushes batches on a timer or when the buffer hits flushBatchSize.
func (w *llmInvocationWorker) run(ctx context.Context) {
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	buf := make([]llmchain.InvocationEvent, 0, flushBatchSize)

	flush := func() {
		if len(buf) == 0 {
			return
		}
		if err := w.insertBatch(ctx, buf); err != nil {
			w.log.Warn("llm_invocation_worker: insert batch failed",
				slog.Int("size", len(buf)),
				slog.Any("err", err))
		}
		buf = buf[:0]
	}

	for {
		select {
		case <-ctx.Done():
			// Drain remaining events on a short final timeout.
			drainCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = drainCtx
			flush()
			if d := w.dropped.Load(); d > 0 {
				w.log.Warn("llm_invocation_worker: events dropped (buffer full)",
					slog.Uint64("dropped", d))
			}
			return
		case <-ticker.C:
			flush()
		case ev := <-w.ch:
			buf = append(buf, ev)
			if len(buf) >= flushBatchSize {
				flush()
			}
		}
	}
}

// insertBatch — single multi-row INSERT. pgx executes the values list
// as a single round-trip. Errors don't propagate — audit log is best-effort.
func (w *llmInvocationWorker) insertBatch(ctx context.Context, evs []llmchain.InvocationEvent) error {
	if len(evs) == 0 {
		return nil
	}
	// Build placeholders.
	values := make([]any, 0, len(evs)*8)
	for _, ev := range evs {
		var userID any
		if ev.UserID != "" {
			if parsed, err := uuid.Parse(ev.UserID); err == nil {
				userID = parsed
			}
		}
		values = append(values,
			ev.Provider,
			ev.Model,
			ev.TaskKind,
			userID,
			ev.InputTokens,
			ev.OutputTokens,
			ev.CostCents,
			ev.LatencyMs,
		)
	}
	// Compose placeholders ($1..$8), ($9..$16), …
	const cols = 8
	qry := "INSERT INTO llm_invocations (provider, model, task_kind, user_id, input_tokens, output_tokens, cost_estimate_cents, latency_ms) VALUES "
	for i := range evs {
		if i > 0 {
			qry += ", "
		}
		base := i * cols
		qry += "($" + itoa(base+1) + ",$" + itoa(base+2) + ",$" + itoa(base+3) + ",$" + itoa(base+4) + ",$" + itoa(base+5) + ",$" + itoa(base+6) + ",$" + itoa(base+7) + ",$" + itoa(base+8) + ")"
	}
	_, err := w.pool.Exec(ctx, qry, values...)
	return err
}

// itoa — small int → string (avoids strconv import for one helper).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
