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
