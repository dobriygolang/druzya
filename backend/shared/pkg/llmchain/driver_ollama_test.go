package llmchain

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestOllamaDriver_NoAuthHeader — главный canary: Ollama не требует
// токен и отвечает 401 на пустой `Bearer `. Проверяем что Authorization
// НЕ выставляется вообще (ни с пустым, ни с каким-либо значением).
func TestOllamaDriver_NoAuthHeader(t *testing.T) {
	t.Parallel()

	var gotAuth string
	var gotAuthPresent bool
	var gotModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// r.Header.Get вернёт "" для обоих "отсутствует" и "пустая
		// строка" — явно проверяем присутствие ключа.
		_, gotAuthPresent = r.Header["Authorization"]
		gotAuth = r.Header.Get("Authorization")

		body, _ := io.ReadAll(r.Body)
		var parsed struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &parsed)
		gotModel = parsed.Model

		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"pong"}}],"usage":{"prompt_tokens":2,"completion_tokens":1},"model":"qwen2.5:3b-instruct-q4_K_M"}`)
	}))
	defer srv.Close()

	// Construct via public constructor, но с фейковым endpoint через
	// замену: используем newOpenAIDriver напрямую чтобы подменить URL
	// (как делает driver_sambanova_test.go).
	inner := newOpenAIDriver(ProviderOllama, "", srv.URL)
	inner.supportsJSONMode = true
	inner.skipAuth = true
	d := &ollamaDriver{openAIDriver: inner}

	resp, err := d.Chat(context.Background(), "qwen2.5:3b-instruct-q4_K_M", Request{
		Task:     TaskSummarize,
		Messages: []Message{{Role: RoleUser, Content: "ping"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if gotAuthPresent {
		t.Errorf("Authorization header should be absent, got %q", gotAuth)
	}
	if gotModel != "qwen2.5:3b-instruct-q4_K_M" {
		t.Errorf("forwarded model = %q, want %q", gotModel, "qwen2.5:3b-instruct-q4_K_M")
	}
	if resp.Provider != ProviderOllama {
		t.Errorf("resp.Provider = %q, want %q", resp.Provider, ProviderOllama)
	}
	if resp.Content != "pong" {
		t.Errorf("resp.Content = %q, want %q", resp.Content, "pong")
	}
}

// TestOllamaDriver_ProviderIdentity — конструктор клеит правильный
// Provider label (защита от copy-paste).
func TestOllamaDriver_ProviderIdentity(t *testing.T) {
	t.Parallel()
	d := NewOllamaDriver("http://ollama:11434")
	if d == nil {
		t.Fatal("NewOllamaDriver with non-empty host returned nil")
	}
	if d.Provider() != ProviderOllama {
		t.Errorf("Provider() = %q, want %q", d.Provider(), ProviderOllama)
	}
}

// TestOllamaDriver_EmptyHostReturnsNil — wirer contract: пустой host
// ⇒ nil, чтобы caller мог пропустить регистрацию без дополнительной
// проверки конфига.
func TestOllamaDriver_EmptyHostReturnsNil(t *testing.T) {
	t.Parallel()
	for _, h := range []string{"", "   ", "/"} {
		if d := NewOllamaDriver(h); d != nil {
			t.Errorf("NewOllamaDriver(%q) = %v, want nil", h, d)
		}
	}
}

// TestOllamaDriver_EndpointFormat — endpoint строится как
// "<host>/v1/chat/completions" без двойных слэшей.
func TestOllamaDriver_EndpointFormat(t *testing.T) {
	t.Parallel()
	// Trailing slash в host должен быть срезан.
	d := NewOllamaDriver("http://ollama:11434/")
	oll, ok := d.(*ollamaDriver)
	if !ok {
		t.Fatalf("NewOllamaDriver: unexpected concrete type %T", d)
	}
	want := "http://ollama:11434/v1/chat/completions"
	if oll.endpoint != want {
		t.Errorf("endpoint = %q, want %q", oll.endpoint, want)
	}
}

// TestOllamaDriver_Stream — SSE работает без Authorization. Мини-canary
// чтобы убедиться что streaming path не ломается на Ollama.
func TestOllamaDriver_Stream(t *testing.T) {
	t.Parallel()

	var gotAuthPresent bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, gotAuthPresent = r.Header["Authorization"]
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		// Два чанка + [DONE].
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"he\"}}],\"model\":\"qwen2.5:3b\"}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2}}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer srv.Close()

	inner := newOpenAIDriver(ProviderOllama, "", srv.URL)
	inner.skipAuth = true
	d := &ollamaDriver{openAIDriver: inner}

	ch, err := d.ChatStream(context.Background(), "qwen2.5:3b-instruct-q4_K_M", Request{
		Task:     TaskCopilotStream,
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	var got strings.Builder
	var doneSeen bool
	for ev := range ch {
		switch {
		case ev.Err != nil:
			t.Fatalf("stream error: %v", ev.Err)
		case ev.Done != nil:
			doneSeen = true
			if ev.Done.Provider != ProviderOllama {
				t.Errorf("Done.Provider = %q, want %q", ev.Done.Provider, ProviderOllama)
			}
		default:
			got.WriteString(ev.Delta)
		}
	}
	if gotAuthPresent {
		t.Errorf("Authorization header must be absent on streaming path too")
	}
	if got.String() != "hello" {
		t.Errorf("stream content = %q, want %q", got.String(), "hello")
	}
	if !doneSeen {
		t.Errorf("stream did not emit Done event")
	}
}

// TestProviderFromModelID_OllamaPrefix — убеждаемся что
// "ollama/qwen2.5:3b-…" маршрутизируется на Ollama (а не OpenRouter как
// раньше, когда prefix был неизвестен).
func TestProviderFromModelID_OllamaPrefix(t *testing.T) {
	t.Parallel()
	got := providerFromModelID("ollama/qwen2.5:3b-instruct-q4_K_M")
	if got != ProviderOllama {
		t.Errorf("providerFromModelID(ollama/...) = %q, want %q", got, ProviderOllama)
	}
}
