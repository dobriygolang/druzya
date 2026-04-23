package infra

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExtractor_HappyPath_PromptAndParse(t *testing.T) {
	t.Parallel()
	var seenSystem string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			t.Errorf("missing Authorization header")
		}
		body, _ := io.ReadAll(r.Body)
		var req map[string]any
		if err := json.Unmarshal(body, &req); err != nil {
			t.Fatalf("decode req: %v", err)
		}
		msgs, _ := req["messages"].([]any)
		if len(msgs) >= 1 {
			if m, ok := msgs[0].(map[string]any); ok {
				seenSystem, _ = m["content"].(string)
			}
		}
		// Reply with a valid JSON-array completion.
		_, _ = w.Write([]byte(`{
			"choices":[{"message":{"content":"[\"go\",\"postgresql\",\"k8s\"]"}}]
		}`))
	}))
	defer srv.Close()

	kv := newMemKV()
	e := NewOpenRouterExtractor("sk-test", kv, nil).WithEndpoint(srv.URL)
	skills, err := e.Extract(context.Background(), "Looking for senior Go dev")
	if err != nil {
		t.Fatalf("Extract: %v", err)
	}
	want := []string{"go", "postgresql", "k8s"}
	if len(skills) != len(want) {
		t.Fatalf("want %v got %v", want, skills)
	}
	for i, s := range want {
		if skills[i] != s {
			t.Errorf("skills[%d]: want %q got %q", i, s, skills[i])
		}
	}
	if !strings.Contains(seenSystem, "JSON array") {
		t.Errorf("system prompt missing 'JSON array': %q", seenSystem)
	}
}

func TestExtractor_CacheHit_SkipsHTTP(t *testing.T) {
	t.Parallel()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"[\"go\"]"}}]}`))
	}))
	defer srv.Close()

	kv := newMemKV()
	e := NewOpenRouterExtractor("sk-test", kv, nil).WithEndpoint(srv.URL)
	desc := "same description here"
	_, _ = e.Extract(context.Background(), desc)
	_, _ = e.Extract(context.Background(), desc)
	if calls != 1 {
		t.Errorf("HTTP calls = %d, want 1 (cache should hit)", calls)
	}
}

func TestExtractor_NoAPIKey_ReturnsEmptyNoError(t *testing.T) {
	t.Parallel()
	e := NewOpenRouterExtractor("", nil, nil)
	out, err := e.Extract(context.Background(), "anything")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(out) != 0 {
		t.Errorf("want empty, got %v", out)
	}
}

func TestExtractor_MalformedJSONFallback(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"go, postgresql, redis"}}]}`))
	}))
	defer srv.Close()
	e := NewOpenRouterExtractor("sk-test", nil, nil).WithEndpoint(srv.URL)
	skills, _ := e.Extract(context.Background(), "x")
	if !contains(skills, "go") || !contains(skills, "redis") {
		t.Errorf("fallback parser missed tags: %v", skills)
	}
}

func TestExtractor_FencedJSON(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("{\"choices\":[{\"message\":{\"content\":\"```json\\n[\\\"go\\\",\\\"redis\\\"]\\n```\"}}]}"))
	}))
	defer srv.Close()
	e := NewOpenRouterExtractor("sk-test", nil, nil).WithEndpoint(srv.URL)
	skills, _ := e.Extract(context.Background(), "x")
	if !contains(skills, "go") || !contains(skills, "redis") {
		t.Errorf("fenced parser failed: %v", skills)
	}
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
