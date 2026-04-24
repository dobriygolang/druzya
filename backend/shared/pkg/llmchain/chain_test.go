package llmchain

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────
// Test fakes — fakeDriver records what was called and plays a canned
// response script. Ordered per-call scripts let one test exercise
// "groq fails twice then succeeds on cerebras" in a readable setup.
// ─────────────────────────────────────────────────────────────────────────

type fakeScript struct {
	// Exactly one of resp / err / stream is non-zero per entry.
	resp   *Response
	err    error
	stream []StreamEvent // when set, ChatStream replays these; if err is also set, ChatStream returns err BEFORE any chunk
}

type fakeDriver struct {
	provider Provider
	mu       sync.Mutex
	scripts  []fakeScript
	idx      int32 // how many scripts consumed
	calls    []Request
}

func newFakeDriver(p Provider, scripts ...fakeScript) *fakeDriver {
	return &fakeDriver{provider: p, scripts: scripts}
}

func (f *fakeDriver) Provider() Provider { return f.provider }

func (f *fakeDriver) next() fakeScript {
	i := atomic.AddInt32(&f.idx, 1) - 1
	if int(i) >= len(f.scripts) {
		return fakeScript{err: fmt.Errorf("fake: no script #%d for %s", i, f.provider)}
	}
	return f.scripts[i]
}

func (f *fakeDriver) Chat(_ context.Context, model string, req Request) (Response, error) {
	f.mu.Lock()
	f.calls = append(f.calls, req)
	f.mu.Unlock()
	s := f.next()
	if s.err != nil {
		return Response{}, s.err
	}
	if s.resp != nil {
		out := *s.resp
		out.Provider = f.provider
		out.Model = model
		return out, nil
	}
	return Response{Provider: f.provider, Model: model, Content: "ok"}, nil
}

func (f *fakeDriver) ChatStream(ctx context.Context, model string, req Request) (<-chan StreamEvent, error) {
	f.mu.Lock()
	f.calls = append(f.calls, req)
	f.mu.Unlock()
	s := f.next()
	if s.err != nil && len(s.stream) == 0 {
		return nil, s.err
	}
	ch := make(chan StreamEvent, len(s.stream)+1)
	for _, ev := range s.stream {
		ch <- ev
	}
	close(ch)
	return ch, nil
}

func testChain(t *testing.T, drivers map[Provider]Driver, order []Provider) *Chain {
	t.Helper()
	c, err := NewChain(drivers, Options{
		Order: order,
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("NewChain: %v", err)
	}
	return c
}

// ─────────────────────────────────────────────────────────────────────────
// Happy path.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_Chat_HappyPath_FirstProvider(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{resp: &Response{Content: "groq-ok"}})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "should-not-be-called"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq:     groq,
		ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	resp, err := c.Chat(context.Background(), Request{Task: TaskVacanciesJSON, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Content != "groq-ok" || resp.Provider != ProviderGroq {
		t.Errorf("wrong response: %+v", resp)
	}
	if len(cerebras.calls) != 0 {
		t.Errorf("fallback fired unnecessarily: cerebras called %d times", len(cerebras.calls))
	}
}

// ─────────────────────────────────────────────────────────────────────────
// 429 on first provider → fallback to second.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_Chat_FallsThrough_On429(t *testing.T) {
	t.Parallel()
	rateErr := fmt.Errorf("groq 429: %w", ErrRateLimited)
	groq := newFakeDriver(ProviderGroq, fakeScript{err: rateErr})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "cerebras-ok"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	resp, err := c.Chat(context.Background(), Request{Task: TaskVacanciesJSON, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Provider != ProviderCerebras {
		t.Errorf("expected cerebras, got %+v", resp)
	}
	// Groq should be cooled now — next call skips it.
	_, _ = c.Chat(context.Background(), Request{Task: TaskVacanciesJSON, Messages: []Message{{Role: RoleUser, Content: "y"}}})
	// Only first call touched groq; the second went straight to cerebras.
	if len(groq.calls) != 1 {
		t.Errorf("expected groq cooled after 429, but called %d times", len(groq.calls))
	}
	if len(cerebras.calls) != 2 {
		t.Errorf("cerebras calls=%d, want 2 (happy then warm-cooldown fallback)", len(cerebras.calls))
	}
}

// ─────────────────────────────────────────────────────────────────────────
// 5xx → fall through.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_Chat_FallsThrough_On5xx(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{err: fmt.Errorf("groq: %w", ErrProviderDown)})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "cerebras-ok"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	resp, err := c.Chat(context.Background(), Request{Task: TaskInsightProse, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Provider != ProviderCerebras {
		t.Errorf("got %+v", resp)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// 400 → fatal, no fallback.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_Chat_BadRequest_IsFatal(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{err: fmt.Errorf("input missing field: %w", ErrBadRequest)})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "should-not-call"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	_, err := c.Chat(context.Background(), Request{Task: TaskVacanciesJSON, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err == nil {
		t.Fatalf("expected error")
	}
	if !errors.Is(err, ErrBadRequest) {
		t.Errorf("expected ErrBadRequest, got %v", err)
	}
	if len(cerebras.calls) != 0 {
		t.Errorf("cerebras should not be called on 400; was called %d times", len(cerebras.calls))
	}
}

// ─────────────────────────────────────────────────────────────────────────
// 401 → long cooldown but still falls through.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_Chat_Unauthorized_FallsThroughButCoolsLong(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{err: fmt.Errorf("bad key: %w", ErrUnauthorized)})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "cerebras-ok"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	resp, err := c.Chat(context.Background(), Request{Task: TaskVacanciesJSON, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Provider != ProviderCerebras {
		t.Errorf("got %+v", resp)
	}
	// Groq cooled ~1h — advance clock 10min, still cooled.
	groqState := c.stateOf(ProviderGroq, c.taskMap.ModelFor(TaskVacanciesJSON, ProviderGroq))
	blocked, _, reason := groqState.blocked(time.Now().Add(10 * time.Minute))
	if !blocked {
		t.Errorf("expected groq still cooled after 10min, reason=%q", reason)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// All providers fail → AllProvidersUnavailableError with attempts.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_Chat_AllFail(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{err: fmt.Errorf("groq: %w", ErrRateLimited)})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{err: fmt.Errorf("cerebras: %w", ErrProviderDown)})
	openrouter := newFakeDriver(ProviderOpenRouter, fakeScript{err: fmt.Errorf("openrouter: %w", ErrUnauthorized)})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras, ProviderOpenRouter: openrouter,
	}, []Provider{ProviderGroq, ProviderCerebras, ProviderOpenRouter})

	_, err := c.Chat(context.Background(), Request{Task: TaskVacanciesJSON, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err == nil {
		t.Fatalf("expected error")
	}
	if !errors.Is(err, ErrAllProvidersUnavailable) {
		t.Errorf("expected ErrAllProvidersUnavailable, got %v", err)
	}
	var apue *AllProvidersUnavailableError
	if !errors.As(err, &apue) {
		t.Fatalf("expected *AllProvidersUnavailableError, got %T", err)
	}
	if len(apue.Attempts) != 3 {
		t.Errorf("expected 3 attempts, got %d", len(apue.Attempts))
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ChatStream: first-chunk fallback.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_ChatStream_FallsThroughBeforeFirstChunk(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{err: fmt.Errorf("groq: %w", ErrRateLimited)})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{stream: []StreamEvent{
		{Delta: "hi "},
		{Delta: "there"},
		{Done: &DoneInfo{Provider: ProviderCerebras, Model: "llama3.3-70b", TokensOut: 2}},
	}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	ch, err := c.ChatStream(context.Background(), Request{Task: TaskCopilotStream, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	var got string
	for ev := range ch {
		if ev.Delta != "" {
			got += ev.Delta
		}
	}
	if got != "hi there" {
		t.Errorf("content = %q", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ChatStream: mid-stream failure is NOT recovered (caller sees err).
// ─────────────────────────────────────────────────────────────────────────

func TestChain_ChatStream_MidStreamErr_NotRecovered(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{stream: []StreamEvent{
		{Delta: "partial "},
		{Err: errors.New("upstream closed unexpectedly")},
	}})
	// Cerebras is configured but must NOT be consulted once groq emitted a chunk.
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "should-not-be-called"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	ch, err := c.ChatStream(context.Background(), Request{Task: TaskCopilotStream, Messages: []Message{{Role: RoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	var sawErr bool
	for ev := range ch {
		if ev.Err != nil {
			sawErr = true
		}
	}
	if !sawErr {
		t.Errorf("expected mid-stream error to propagate")
	}
	if len(cerebras.calls) != 0 {
		t.Errorf("cerebras called after mid-stream failure; it must not")
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ModelOverride bypass: user pinned specific model, no fallback.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_Chat_ModelOverride_NoFallback(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{err: fmt.Errorf("rate: %w", ErrRateLimited)})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "c"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	_, err := c.Chat(context.Background(), Request{
		ModelOverride: "groq/llama-3.3-70b-versatile",
		Messages:      []Message{{Role: RoleUser, Content: "x"}},
	})
	// User picked groq explicitly — no fallback, so 429 propagates.
	if err == nil {
		t.Fatalf("expected rate-limited error to propagate")
	}
	if !errors.Is(err, ErrAllProvidersUnavailable) {
		t.Errorf("expected AllProvidersUnavailable, got %v", err)
	}
	if len(cerebras.calls) != 0 {
		t.Errorf("cerebras should not be called when user pins groq")
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Proactive cooldown from rate-limit headers.
// ─────────────────────────────────────────────────────────────────────────

func TestRateLimitHeaders_ProactiveCooldown(t *testing.T) {
	t.Parallel()
	// Simulate that Groq returned 200 but with remaining=1, reset in 30s.
	h := http.Header{}
	h.Set("x-ratelimit-remaining-requests", "1")
	h.Set("x-ratelimit-reset-requests", "30s")

	s := &rateState{}
	rem, reset := parseRateLimitHeaders(ProviderGroq, h, time.Unix(0, 0))
	if rem != 1 {
		t.Errorf("remaining = %d, want 1", rem)
	}
	s.recordResponse(rem, reset)
	now := time.Unix(0, 0)
	blocked, until, _ := s.blocked(now)
	if !blocked {
		t.Errorf("expected preemptive cooldown when remaining=1")
	}
	expected := now.Add(30 * time.Second)
	if !until.Equal(expected) {
		t.Errorf("cooldown until %v, want %v", until, expected)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// parseRetryAfter: seconds format.
// ─────────────────────────────────────────────────────────────────────────

func TestParseRetryAfter_Seconds(t *testing.T) {
	t.Parallel()
	got := parseRetryAfter("45", time.Now())
	if got != 45*time.Second {
		t.Errorf("got %v, want 45s", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Passive latency window: p95 computation.
// ─────────────────────────────────────────────────────────────────────────

func TestLatencyWindow_P95_NeedsMinSamples(t *testing.T) {
	t.Parallel()
	w := newLatencyWindow(50)
	for i := 0; i < minSamplesForReorder-1; i++ {
		w.Record(100 * time.Millisecond)
	}
	if _, ok := w.P95(); ok {
		t.Errorf("expected !ok below min samples floor")
	}
	w.Record(100 * time.Millisecond) // hit the threshold
	if _, ok := w.P95(); !ok {
		t.Errorf("expected ok at %d samples", minSamplesForReorder)
	}
}

func TestLatencyWindow_P95_RollsOff(t *testing.T) {
	t.Parallel()
	w := newLatencyWindow(50)
	// Fill window with 5s each.
	for i := 0; i < 50; i++ {
		w.Record(5 * time.Second)
	}
	p, _ := w.P95()
	if p != 5*time.Second {
		t.Errorf("steady 5s window → p95 = %v, want 5s", p)
	}
	// Overwrite with 1s each — old 5s entries evict.
	for i := 0; i < 50; i++ {
		w.Record(1 * time.Second)
	}
	p, _ = w.P95()
	if p != 1*time.Second {
		t.Errorf("after rollover → p95 = %v, want 1s", p)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Chain reorder: warm second provider promoted ahead of slow primary.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_ReordersByLatency_WhenBothWarm(t *testing.T) {
	t.Parallel()
	// Groq is the static primary but will be "slow" (we pre-seed its
	// window with large durations). Cerebras is configured as secondary
	// but will be seeded "fast". After both are warm (≥ minSamples),
	// the next request should go to Cerebras first.
	groq := newFakeDriver(ProviderGroq, fakeScript{resp: &Response{Content: "g-fallback"}})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "c-promoted"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	groqModel := c.taskMap.ModelFor(TaskVacanciesJSON, ProviderGroq)
	cerebrasModel := c.taskMap.ModelFor(TaskVacanciesJSON, ProviderCerebras)
	// Pre-seed: Groq slow (5s), Cerebras fast (200ms). 15 samples each
	// clears the minSamplesForReorder floor.
	for i := 0; i < 15; i++ {
		c.latency.Record(ProviderGroq, groqModel, TaskVacanciesJSON, 5*time.Second)
		c.latency.Record(ProviderCerebras, cerebrasModel, TaskVacanciesJSON, 200*time.Millisecond)
	}

	resp, err := c.Chat(context.Background(), Request{
		Task:     TaskVacanciesJSON,
		Messages: []Message{{Role: RoleUser, Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Provider != ProviderCerebras {
		t.Errorf("expected Cerebras (faster p95) to serve, got %s content=%q", resp.Provider, resp.Content)
	}
	if len(groq.calls) != 0 {
		t.Errorf("Groq should NOT have been consulted: calls=%d", len(groq.calls))
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Cold start: no samples → static order preserved.
// ─────────────────────────────────────────────────────────────────────────

func TestChain_ColdStart_PreservesStaticOrder(t *testing.T) {
	t.Parallel()
	groq := newFakeDriver(ProviderGroq, fakeScript{resp: &Response{Content: "g"}})
	cerebras := newFakeDriver(ProviderCerebras, fakeScript{resp: &Response{Content: "c"}})
	c := testChain(t, map[Provider]Driver{
		ProviderGroq: groq, ProviderCerebras: cerebras,
	}, []Provider{ProviderGroq, ProviderCerebras})

	// No seeded latency data. Expect first call to honor the static
	// LLM_CHAIN_ORDER even though nothing is learned yet.
	resp, err := c.Chat(context.Background(), Request{
		Task:     TaskVacanciesJSON,
		Messages: []Message{{Role: RoleUser, Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Provider != ProviderGroq {
		t.Errorf("cold-start: expected static primary Groq, got %s", resp.Provider)
	}
}
