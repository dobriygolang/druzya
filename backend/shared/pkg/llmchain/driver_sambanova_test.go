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

// TestSambaNovaDriver_WireShape asserts the OpenAI-compatible request
// leaves the driver with:
//  1. the correct Authorization: Bearer header,
//  2. content-type json,
//  3. a well-formed chat-completions body with the caller's model id.
//
// We don't re-verify the shared openAIDriver logic (covered in the
// existing chain tests via fakeDriver); this is the narrow "I didn't
// wire the endpoint / auth wrong" canary.
func TestSambaNovaDriver_WireShape(t *testing.T) {
	t.Parallel()

	var gotAuth, gotCT, gotModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")

		body, _ := io.ReadAll(r.Body)
		var parsed struct {
			Model    string `json:"model"`
			Messages []any  `json:"messages"`
		}
		_ = json.Unmarshal(body, &parsed)
		gotModel = parsed.Model

		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1},"model":"Meta-Llama-3.3-70B-Instruct"}`)
	}))
	defer srv.Close()

	// Build a SambaNova-identity driver pointed at the fake server.
	// We use newOpenAIDriver directly (package-internal) to swap the
	// endpoint — the public constructor bakes the real URL in.
	inner := newOpenAIDriver(ProviderSambaNova, "test-key", srv.URL)
	inner.supportsJSONMode = true
	d := &sambaNovaDriver{openAIDriver: inner}

	resp, err := d.Chat(context.Background(), "Meta-Llama-3.3-70B-Instruct", Request{
		Task:     TaskInsightProse,
		Messages: []Message{{Role: RoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Provider != ProviderSambaNova {
		t.Errorf("resp.Provider = %q, want %q", resp.Provider, ProviderSambaNova)
	}
	if gotAuth != "Bearer test-key" {
		t.Errorf("Authorization header = %q, want %q", gotAuth, "Bearer test-key")
	}
	if !strings.HasPrefix(gotCT, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", gotCT)
	}
	if gotModel != "Meta-Llama-3.3-70B-Instruct" {
		t.Errorf("forwarded model = %q, want Meta-Llama-3.3-70B-Instruct", gotModel)
	}
}

// TestSambaNovaDriver_EndpointConstant is a cheap guard against someone
// accidentally editing the public endpoint constant — a wrong value
// ships silently (the driver just starts getting 404/DNS errors in
// prod).
func TestSambaNovaDriver_EndpointConstant(t *testing.T) {
	t.Parallel()
	const want = "https://api.sambanova.ai/v1/chat/completions"
	if SambaNovaEndpoint != want {
		t.Errorf("SambaNovaEndpoint = %q, want %q", SambaNovaEndpoint, want)
	}
}

// TestSambaNovaDriver_ProviderIdentity — constructor wires the right
// provider label. Sounds trivial but catches copy-paste bugs where a
// new driver is built with someone else's Provider constant.
func TestSambaNovaDriver_ProviderIdentity(t *testing.T) {
	t.Parallel()
	d := NewSambaNovaDriver("dummy")
	if d.Provider() != ProviderSambaNova {
		t.Errorf("Provider() = %q, want %q", d.Provider(), ProviderSambaNova)
	}
}
