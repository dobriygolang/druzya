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

// TestCloudflareAIDriver_EndpointTemplate verifies that the account ID
// is substituted into the Cloudflare-specific URL shape. If CF ever
// renames the path or moves to a different host we want the test to
// be the first thing to notice, not prod.
func TestCloudflareAIDriver_EndpointTemplate(t *testing.T) {
	t.Parallel()
	got := fmt.Sprintf(cloudflareEndpointTemplate, "acct-abc123")
	want := "https://api.cloudflare.com/client/v4/accounts/acct-abc123/ai/v1/chat/completions"
	if got != want {
		t.Errorf("endpoint = %q, want %q", got, want)
	}
}

// TestCloudflareAIDriver_WireShape checks:
//  1. Bearer token goes into Authorization (NOT into the URL),
//  2. @cf/<vendor>/<model> id is preserved verbatim (not stripped as
//     a "provider prefix" by the shared openAIDriver logic),
//  3. Provider identity on the response matches the constant.
func TestCloudflareAIDriver_WireShape(t *testing.T) {
	t.Parallel()

	var gotAuth, gotModel, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		var parsed struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &parsed)
		gotModel = parsed.Model

		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1},"model":"@cf/meta/llama-3.3-70b-instruct-fp8-fast"}`)
	}))
	defer srv.Close()

	// Build a cloudflareDriver pointed at the fake server. We bypass
	// NewCloudflareAIDriver because it bakes the real URL in — we'd
	// rather verify the URL shape separately (above) and test wire
	// behaviour against a stub here.
	inner := newOpenAIDriver(ProviderCloudflareAI, "cf-token", srv.URL)
	inner.supportsJSONMode = true
	d := &cloudflareDriver{openAIDriver: inner}

	const modelID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
	resp, err := d.Chat(context.Background(), modelID, Request{
		// NB: no ModelOverride — task routing path. If someone sets
		// ModelOverride here the openAIDriver's stripProviderPrefix
		// would eat the "@cf" segment; the cloudflareDriver already
		// zeros ModelOverride defensively.
		Task:     TaskCopilotStream,
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Provider != ProviderCloudflareAI {
		t.Errorf("resp.Provider = %q, want %q", resp.Provider, ProviderCloudflareAI)
	}
	if gotAuth != "Bearer cf-token" {
		t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer cf-token")
	}
	if gotModel != modelID {
		t.Errorf("model in body = %q, want %q (the @cf/… id must survive unstripped)", gotModel, modelID)
	}
	// httptest.Server strips everything up to the host, so Path should
	// be "/" — we're just asserting the POST reached the stub at all.
	if gotPath == "" {
		t.Errorf("empty request path — server didn't receive the call")
	}
}

// TestCloudflareAIDriver_ModelOverrideZeroed ensures that even when a
// caller mistakenly passes ModelOverride (which would trigger
// stripProviderPrefix in the shared driver), the cloudflareDriver
// wrapper neutralises it so the "@cf/…" id is preserved.
func TestCloudflareAIDriver_ModelOverrideZeroed(t *testing.T) {
	t.Parallel()
	var gotModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var parsed struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &parsed)
		gotModel = parsed.Model
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"content":""}}],"usage":{"prompt_tokens":0,"completion_tokens":0}}`)
	}))
	defer srv.Close()
	inner := newOpenAIDriver(ProviderCloudflareAI, "tok", srv.URL)
	d := &cloudflareDriver{openAIDriver: inner}

	const modelID = "@cf/qwen/qwen2.5-coder-32b-instruct"
	_, err := d.Chat(context.Background(), modelID, Request{
		ModelOverride: modelID, // this would normally be stripped
		Messages:      []Message{{Role: RoleUser, Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	// The leading "@cf" MUST survive — stripProviderPrefix would have
	// made it "meta/llama-…" or "qwen/qwen2.5-…", which CF rejects.
	if !strings.HasPrefix(gotModel, "@cf/") {
		t.Errorf("model id = %q — lost the @cf/ prefix (stripProviderPrefix leaked)", gotModel)
	}
}

// TestCloudflareAIDriver_ProviderIdentity — constructor wires the right
// provider label.
func TestCloudflareAIDriver_ProviderIdentity(t *testing.T) {
	t.Parallel()
	d := NewCloudflareAIDriver("acct", "tok")
	if d.Provider() != ProviderCloudflareAI {
		t.Errorf("Provider() = %q, want %q", d.Provider(), ProviderCloudflareAI)
	}
}

// TestProviderFromModelID_CFPrefix — the chain's dispatcher must route
// "@cf/…" model ids to the CloudflareAI provider. If this breaks,
// ModelOverride=@cf/… silently lands on OpenRouter and 404s.
func TestProviderFromModelID_CFPrefix(t *testing.T) {
	t.Parallel()
	got := providerFromModelID("@cf/meta/llama-3.3-70b-instruct-fp8-fast")
	if got != ProviderCloudflareAI {
		t.Errorf("providerFromModelID(@cf/…) = %q, want %q", got, ProviderCloudflareAI)
	}
}

// TestProviderFromModelID_SambaNovaPrefix — same check for sambanova/…
// overrides.
func TestProviderFromModelID_SambaNovaPrefix(t *testing.T) {
	t.Parallel()
	got := providerFromModelID("sambanova/Meta-Llama-3.3-70B-Instruct")
	if got != ProviderSambaNova {
		t.Errorf("providerFromModelID(sambanova/…) = %q, want %q", got, ProviderSambaNova)
	}
}
