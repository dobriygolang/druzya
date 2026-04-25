package infra

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

// payload returns a valid InsightPayload with a non-empty WeekISO so the
// guard in Generate doesn't short-circuit before we exercise the path under
// test.
func payload() InsightPayload {
	return InsightPayload{
		WeekISO:           "2026-W17",
		EloDelta:          42,
		WinRateBySection:  map[string]int{"algorithms": 80, "sql": 50},
		HoursStudied:      6.5,
		Streak:            5,
		WeakestSection:    "sql",
	}
}

func TestInsight_EmptyAPIKey_ReturnsEmptyAndNoError(t *testing.T) {
	t.Parallel()
	c := NewInsightClient(nil, "", "", testLog())
	if !c.Disabled() {
		t.Fatalf("expected client to be disabled when api key empty")
	}
	out, err := c.Generate(context.Background(), uuid.New(), payload())
	if err != nil {
		t.Fatalf("expected no error in disabled mode, got %v", err)
	}
	if out != "" {
		t.Fatalf("expected empty insight, got %q (anti-fallback: never fake LLM output)", out)
	}
}

func TestInsight_HappyPath_ParsesCompletion(t *testing.T) {
	t.Parallel()
	var sawAuth bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sawAuth = true
		}
		body, _ := io.ReadAll(r.Body)
		var req map[string]any
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("decode req: %v", err)
		}
		// Sanity: ensure both system + user messages were sent.
		msgs, _ := req["messages"].([]any)
		if len(msgs) != 2 {
			t.Fatalf("expected 2 messages, got %d", len(msgs))
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"  Отлично сыграл по алгоритмам.\n\nНа следующей неделе — SQL-оконные функции.  "}}]}`))
	}))
	defer srv.Close()

	kv := newMemKV()
	c := NewInsightClient(nil, "sk-test", "anthropic/claude-sonnet-4", testLog()).
		WithEndpoint(srv.URL).WithKV(kv)
	out, err := c.Generate(context.Background(), uuid.New(), payload())
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if !sawAuth {
		t.Errorf("Authorization header missing")
	}
	if out != "Отлично сыграл по алгоритмам.\n\nНа следующей неделе — SQL-оконные функции." {
		t.Errorf("unexpected insight payload: %q", out)
	}
}

func TestInsight_5xx_ReturnsError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`upstream offline`))
	}))
	defer srv.Close()
	c := NewInsightClient(nil, "sk-test", "", testLog()).WithEndpoint(srv.URL)
	_, err := c.Generate(context.Background(), uuid.New(), payload())
	if err == nil {
		t.Fatal("expected error on 5xx response, got nil (anti-fallback policy)")
	}
}

func TestInsight_CacheHit_NoUpstreamCall(t *testing.T) {
	t.Parallel()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"first call"}}]}`))
	}))
	defer srv.Close()

	kv := newMemKV()
	c := NewInsightClient(nil, "sk-test", "", testLog()).
		WithEndpoint(srv.URL).WithKV(kv)
	uid := uuid.New()
	first, err := c.Generate(context.Background(), uid, payload())
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	second, err := c.Generate(context.Background(), uid, payload())
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if first != "first call" || second != "first call" {
		t.Fatalf("unexpected payloads: %q / %q", first, second)
	}
	if calls != 1 {
		t.Fatalf("HTTP calls = %d, want 1 (cache miss then hit)", calls)
	}
}

func TestInsight_EmptyWeekISO_IsRejected(t *testing.T) {
	t.Parallel()
	c := NewInsightClient(nil, "sk-test", "", testLog())
	p := payload()
	p.WeekISO = ""
	if _, err := c.Generate(context.Background(), uuid.New(), p); err == nil {
		t.Fatal("expected error when WeekISO is empty")
	}
}

func TestInsight_NilLogger_Panics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic when logger is nil (anti-fallback policy)")
		}
	}()
	_ = NewInsightClient(nil, "sk-test", "", nil)
}
