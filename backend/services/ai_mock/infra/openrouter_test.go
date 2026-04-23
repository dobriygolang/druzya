package infra

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"druz9/ai_mock/domain"
)

// fastClient returns a client with retries dialled down so tests don't waste
// real wall-time on backoff. We keep the production retry counts though — the
// point is to exercise the loop, not skip it.
func fastClient(apiKey, endpoint string) *OpenRouter {
	c := NewOpenRouter(apiKey).WithEndpoint(endpoint)
	c.baseBackoff = 5 * time.Millisecond
	return c
}

func TestOpenRouter_Complete(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"id":"x",
			"model":"openai/gpt-4o-mini",
			"choices":[{"message":{"content":"hello back"}}],
			"usage":{"total_tokens": 42}
		}`)
	}))
	defer srv.Close()

	c := NewOpenRouter("test-key").WithEndpoint(srv.URL)
	resp, err := c.Complete(context.Background(), domain.CompletionRequest{
		Model:    "openai/gpt-4o-mini",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if resp.Content != "hello back" {
		t.Fatalf("Content = %q, want 'hello back'", resp.Content)
	}
	if resp.TokensUsed != 42 {
		t.Fatalf("TokensUsed = %d, want 42", resp.TokensUsed)
	}
}

func TestOpenRouter_Complete_RetriesOn429(t *testing.T) {
	t.Parallel()
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n < 3 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"}}],"usage":{"total_tokens":1}}`)
	}))
	defer srv.Close()

	c := NewOpenRouter("").WithEndpoint(srv.URL)
	c.baseBackoff = 5 * time.Millisecond // speed up
	resp, err := c.Complete(context.Background(), domain.CompletionRequest{Model: "m", Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("Complete: %v (hits=%d)", err, hits)
	}
	if resp.Content != "ok" {
		t.Fatalf("Content = %q", resp.Content)
	}
	if atomic.LoadInt32(&hits) != 3 {
		t.Fatalf("expected 3 attempts (2x429 then 200), got %d", hits)
	}
}

// TestOpenRouter_Complete_RetriesOn5xx covers the recently-added 5xx retry
// branch. Without it a single 503 from OpenRouter would bubble up as a hard
// error to the caller; the bible mandates retry-with-backoff for transient
// upstream failures.
func TestOpenRouter_Complete_RetriesOn5xx(t *testing.T) {
	t.Parallel()
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, "upstream slow")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"recovered"}}],"usage":{"total_tokens":2}}`)
	}))
	defer srv.Close()

	c := fastClient("", srv.URL)
	resp, err := c.Complete(context.Background(), domain.CompletionRequest{
		Model:    "m",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Complete: %v (hits=%d)", err, atomic.LoadInt32(&hits))
	}
	if resp.Content != "recovered" {
		t.Fatalf("Content = %q", resp.Content)
	}
	if atomic.LoadInt32(&hits) != 3 {
		t.Fatalf("expected 3 attempts (2x503 then 200), got %d", hits)
	}
}

// TestOpenRouter_Complete_5xxExhausted ensures we surface a clear error after
// the retry budget is spent — production must page on this, not silently
// return empty content.
func TestOpenRouter_Complete_5xxExhausted(t *testing.T) {
	t.Parallel()
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	c := fastClient("", srv.URL)
	_, err := c.Complete(context.Background(), domain.CompletionRequest{
		Model:    "m",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}},
	})
	if err == nil {
		t.Fatal("expected exhausted-retries error")
	}
	if !strings.Contains(err.Error(), "502") {
		t.Fatalf("error should mention status code, got: %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 4 { // initial + 3 retries
		t.Fatalf("expected 4 attempts, got %d", got)
	}
}

// TestOpenRouter_Complete_ContextTimeout pins down the cancel path: if the
// caller's context expires mid-request we must not hang or retry forever.
func TestOpenRouter_Complete_ContextTimeout(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Sleep longer than the test's context budget.
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"too late"}}]}`)
	}))
	defer srv.Close()

	c := fastClient("", srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	_, err := c.Complete(ctx, domain.CompletionRequest{
		Model:    "m",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}},
	})
	if err == nil {
		t.Fatal("expected ctx-cancelled error")
	}
	if !strings.Contains(err.Error(), "context") && !strings.Contains(err.Error(), "deadline") {
		t.Fatalf("error should mention context/deadline, got: %v", err)
	}
}

// TestOpenRouter_Complete_NetworkError covers the path where the dial itself
// fails. We point the client at a closed listener so connect() returns a
// transport error.
func TestOpenRouter_Complete_NetworkError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close() // immediately — listener now refuses connections

	c := fastClient("", srv.URL)
	_, err := c.Complete(context.Background(), domain.CompletionRequest{
		Model:    "m",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}},
	})
	if err == nil {
		t.Fatal("expected network error")
	}
}

// TestOpenRouter_Complete_MalformedJSONResponse — a lying upstream that
// returns 200 + non-JSON body. We bubble up a decode error rather than
// pretend the LLM said "".
func TestOpenRouter_Complete_MalformedJSONResponse(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{not valid json`)
	}))
	defer srv.Close()

	c := fastClient("", srv.URL)
	_, err := c.Complete(context.Background(), domain.CompletionRequest{
		Model:    "m",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}},
	})
	if err == nil {
		t.Fatal("expected decode error")
	}
	if !strings.Contains(err.Error(), "decode") {
		t.Fatalf("error should mention decode, got: %v", err)
	}
}

// TestOpenRouter_Complete_EmptyChoices — well-formed JSON without a choices
// array (e.g. when the upstream rejects the model with a soft error). We
// must NOT silently return content="".
func TestOpenRouter_Complete_EmptyChoices(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"x","choices":[]}`)
	}))
	defer srv.Close()

	c := fastClient("", srv.URL)
	_, err := c.Complete(context.Background(), domain.CompletionRequest{
		Model:    "m",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}},
	})
	if err == nil {
		t.Fatal("expected empty-choices error")
	}
	if !strings.Contains(err.Error(), "empty choices") {
		t.Fatalf("error should mention empty choices, got: %v", err)
	}
}

// TestOpenRouter_Complete_RateLimitWithRetryAfter — verifies we honour the
// Retry-After header on 429 (instead of falling back to baseBackoff). We use
// a 1s header so the test still finishes quickly.
func TestOpenRouter_Complete_RateLimitWithRetryAfter(t *testing.T) {
	t.Parallel()
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"}}]}`)
	}))
	defer srv.Close()

	c := fastClient("", srv.URL)
	start := time.Now()
	resp, err := c.Complete(context.Background(), domain.CompletionRequest{
		Model:    "m",
		Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if resp.Content != "ok" {
		t.Fatalf("Content = %q", resp.Content)
	}
	if elapsed := time.Since(start); elapsed < 800*time.Millisecond {
		t.Fatalf("expected to wait ≥1s for Retry-After, only waited %v", elapsed)
	}
}

func TestOpenRouter_Stream(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		chunks := []string{
			`{"choices":[{"delta":{"content":"Hel"}}]}`,
			`{"choices":[{"delta":{"content":"lo"}}]}`,
			`{"choices":[{"delta":{"content":"!"}, "finish_reason":"stop"}],"usage":{"total_tokens":3}}`,
		}
		for _, c := range chunks {
			fmt.Fprintf(w, "data: %s\n\n", c)
			if flusher != nil {
				flusher.Flush()
			}
		}
		fmt.Fprintf(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer srv.Close()

	c := NewOpenRouter("").WithEndpoint(srv.URL)
	ch, err := c.Stream(context.Background(), domain.CompletionRequest{Model: "m", Messages: []domain.LLMMessage{{Role: domain.LLMRoleUser, Content: "x"}}})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var sb strings.Builder
	var done bool
	var tokens int
	for tok := range ch {
		if tok.Err != nil {
			t.Fatalf("token error: %v", tok.Err)
		}
		sb.WriteString(tok.Delta)
		if tok.Done {
			done = true
			tokens = tok.TokensUsed
		}
	}
	if !done {
		t.Fatal("stream never reported Done=true")
	}
	if sb.String() != "Hello!" {
		t.Fatalf("assembled content = %q, want 'Hello!'", sb.String())
	}
	_ = tokens // tokens reporting is best-effort
}
