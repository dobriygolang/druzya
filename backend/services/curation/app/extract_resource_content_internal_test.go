// extract_resource_content_internal_test.go — Phase D3 batched
// extraction smoke tests. Lives in the `app` package to exercise the
// unexported parseExtractedBatch and the ExtractMany pipeline with a
// stub ChatClient that doesn't touch the network.
package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"druz9/curation"
	"druz9/curation/domain"
	"druz9/shared/pkg/llmchain"
)

// stubChain implements llmchain.ChatClient with a canned response and a
// call counter — the test asserts ExtractMany batches multiple URLs into
// a single Chat call instead of N sequential ones.
type stubChain struct {
	calls    atomic.Int32
	response string
	err      error
}

func (s *stubChain) Chat(_ context.Context, _ llmchain.Request) (llmchain.Response, error) {
	s.calls.Add(1)
	if s.err != nil {
		return llmchain.Response{}, s.err
	}
	return llmchain.Response{Content: s.response}, nil
}

func (s *stubChain) ChatStream(_ context.Context, _ llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	return nil, nil
}

func TestParseExtractedBatch_PlainArray(t *testing.T) {
	raw := `[
		{"url":"https://a.example/x","title":"A","kind":"article","level":"B","priority":"core","why":"","topics_covered":["t1"]},
		{"url":"https://b.example/y","title":"B","kind":"video","level":"C","priority":"supplement","why":"","topics_covered":["t2","ghost"]}
	]`
	got, err := parseExtractedBatch(raw, []string{"t1", "t2"})
	if err != nil {
		t.Fatalf("parse err: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 entries, got %d", len(got))
	}
	if r, ok := got["https://a.example/x"]; !ok || r.Title != "A" {
		t.Fatalf("missing or wrong A entry: %+v", r)
	}
	b := got["https://b.example/y"]
	if len(b.TopicsCovered) != 1 || b.TopicsCovered[0] != "t2" {
		t.Fatalf("topic filter failed: %+v", b.TopicsCovered)
	}
}

func TestParseExtractedBatch_FencedAndDefaults(t *testing.T) {
	raw := "```json\n[{\"url\":\"https://a.example/z\",\"title\":\"Z\"}]\n```"
	got, err := parseExtractedBatch(raw, nil)
	if err != nil {
		t.Fatalf("parse err: %v", err)
	}
	r := got["https://a.example/z"]
	if r.Why != "user-curated" || r.Kind != domain.KindArticle || r.Level != domain.LevelB || r.Priority != domain.PrioritySupplement {
		t.Fatalf("defaults not applied: %+v", r)
	}
}

func TestParseExtractedBatch_WrappedObject(t *testing.T) {
	raw := `{"items":[{"url":"https://a.example/q","title":"Q"}]}`
	got, err := parseExtractedBatch(raw, nil)
	if err != nil {
		t.Fatalf("parse err: %v", err)
	}
	if _, ok := got["https://a.example/q"]; !ok {
		t.Fatalf("wrapped object form not parsed")
	}
}

func TestParseExtractedBatch_DropsRowsWithoutURL(t *testing.T) {
	raw := `[{"url":"","title":"orphan"},{"url":"https://a.example/k","title":"K"}]`
	got, err := parseExtractedBatch(raw, nil)
	if err != nil {
		t.Fatalf("parse err: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 entry (orphan dropped), got %d", len(got))
	}
}

func TestExtractMany_BatchesIntoSingleLLMCall(t *testing.T) {
	ExtractCacheReset()
	t.Cleanup(ExtractCacheReset)

	// Three pages, three different paths — but one shared origin so the
	// httptest server can answer all of them.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>` + r.URL.Path + `</title></head><body><article>` + strings.Repeat("hello world ", 80) + `</article></body></html>`))
	}))
	t.Cleanup(srv.Close)

	urls := []string{srv.URL + "/a", srv.URL + "/b", srv.URL + "/c"}
	resp := `[
		{"url":"` + urls[0] + `","title":"A","kind":"article","level":"B","priority":"core","why":"good","topics_covered":[]},
		{"url":"` + urls[1] + `","title":"B","kind":"article","level":"B","priority":"core","why":"good","topics_covered":[]},
		{"url":"` + urls[2] + `","title":"C","kind":"article","level":"B","priority":"core","why":"good","topics_covered":[]}
	]`
	chain := &stubChain{response: resp}

	uc := &ExtractResourceContent{
		Fetcher: &curation.Fetcher{HTTPClient: srv.Client(), MaxBytes: 1 << 20},
		Chain:   chain,
		Timeout: 5 * time.Second,
	}

	out, err := uc.ExtractMany(context.Background(), urls, nil)
	if err != nil {
		t.Fatalf("ExtractMany err: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("want 3 outputs, got %d", len(out))
	}
	for i, o := range out {
		if o.Manual {
			t.Fatalf("output %d marked manual: %+v", i, o)
		}
		if o.Preview.URL != urls[i] {
			t.Fatalf("output %d url mismatch: got %q want %q", i, o.Preview.URL, urls[i])
		}
	}
	if got := chain.calls.Load(); got != 1 {
		t.Fatalf("want 1 batched LLM call, got %d", got)
	}
}

func TestExtractMany_CacheShortCircuit(t *testing.T) {
	ExtractCacheReset()
	t.Cleanup(ExtractCacheReset)

	// Pre-seed the cache for one URL — ExtractMany should NOT fetch or
	// hit the LLM for it.
	cachedURL := "https://cached.example/x"
	cachedRes := domain.Resource{URL: cachedURL, Title: "cached", Kind: domain.KindArticle, Level: domain.LevelB, Priority: domain.PriorityCore, Why: "ok"}
	globalExtractCache.set(ExtractInput{URL: cachedURL}.CacheKey(), cachedRes)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>fresh</title></head><body><article>` + strings.Repeat("hello world ", 80) + `</article></body></html>`))
	}))
	t.Cleanup(srv.Close)

	freshURL := srv.URL + "/fresh"
	resp := `[{"url":"` + freshURL + `","title":"fresh","kind":"article","level":"B","priority":"core","why":"ok","topics_covered":[]}]`
	chain := &stubChain{response: resp}

	uc := &ExtractResourceContent{
		Fetcher: &curation.Fetcher{HTTPClient: srv.Client(), MaxBytes: 1 << 20},
		Chain:   chain,
		Timeout: 5 * time.Second,
	}

	out, err := uc.ExtractMany(context.Background(), []string{cachedURL, freshURL}, nil)
	if err != nil {
		t.Fatalf("ExtractMany err: %v", err)
	}
	if out[0].FetchInfo.Strategy != "cache" || out[0].Preview.Title != "cached" {
		t.Fatalf("cached entry not served from cache: %+v", out[0])
	}
	if out[1].Manual || out[1].Preview.Title != "fresh" {
		t.Fatalf("fresh entry not extracted: %+v", out[1])
	}
	// Only one Chat call — for the single uncached URL.
	if got := chain.calls.Load(); got != 1 {
		t.Fatalf("want 1 LLM call (cache absorbed the other), got %d", got)
	}
}

func TestExtractMany_FallbackOnBatchError(t *testing.T) {
	ExtractCacheReset()
	t.Cleanup(ExtractCacheReset)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(`<html><head><title>t</title></head><body><article>` + strings.Repeat("hello world ", 80) + `</article></body></html>`))
	}))
	t.Cleanup(srv.Close)

	// Stub returns garbage — parse fails, so ExtractMany falls back to
	// per-URL Do() calls. Each Do() then also calls Chat once and gets
	// the same garbage; parseExtractedResource fails; output goes manual.
	chain := &stubChain{response: "not json"}
	uc := &ExtractResourceContent{
		Fetcher: &curation.Fetcher{HTTPClient: srv.Client(), MaxBytes: 1 << 20},
		Chain:   chain,
		Timeout: 5 * time.Second,
	}

	urls := []string{srv.URL + "/a", srv.URL + "/b"}
	out, err := uc.ExtractMany(context.Background(), urls, nil)
	if err != nil {
		t.Fatalf("ExtractMany err: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 outputs, got %d", len(out))
	}
	for i, o := range out {
		if !o.Manual {
			t.Fatalf("output %d should be manual after parse fail: %+v", i, o)
		}
	}
	// 1 batch call + 2 fallback per-URL calls = 3.
	if got := chain.calls.Load(); got != 3 {
		t.Fatalf("want 3 LLM calls (1 batch + 2 fallback), got %d", got)
	}
}
