package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

const wbAPIArrayResp = `[
  {"id":"w1","slug":"go-backend","title":"Go Backend","city":"Москва","employment":"full","description":"Build","requirements":"Go","skills":["Go","PostgreSQL"]},
  {"id":"w2","slug":"data-eng","title":"Data Engineer","city":"Удалённо"}
]`

const wbAPIObjectResp = `{"items":[
  {"id":"w3","slug":"sre","title":"SRE","city":"Москва"}
]}`

const wbHTMLFallback = `<html><body><script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"vacancies":[
  {"id":"h1","slug":"qa","title":"QA Engineer","city":"Минск","description":"Test"}
]}}}
</script></body></html>`

func TestWildberriesParser_APIArrayHappyPath(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("User-Agent"); !strings.Contains(got, "druz9-vacancies") {
			t.Errorf("UA missing marker: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(wbAPIArrayResp))
	}))
	t.Cleanup(srv.Close)

	p := NewWildberries(testLog()).WithAPIURL(srv.URL).WithHTMLURL("")
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	if got[0].Source != domain.SourceWildberries {
		t.Errorf("source: %s", got[0].Source)
	}
	if got[0].Title != "Go Backend" || got[0].Company != "Wildberries" {
		t.Errorf("first item: %+v", got[0])
	}
	if !strings.HasPrefix(got[0].URL, "https://career.wb.ru/") {
		t.Errorf("derived url: %q", got[0].URL)
	}
	if !contains(got[0].NormalizedSkills, "go") {
		t.Errorf("skills: %v", got[0].NormalizedSkills)
	}
}

func TestWildberriesParser_APIObjectShape(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(wbAPIObjectResp))
	}))
	t.Cleanup(srv.Close)

	p := NewWildberries(testLog()).WithAPIURL(srv.URL).WithHTMLURL("")
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 1 || got[0].Title != "SRE" {
		t.Errorf("want 1xSRE, got %+v", got)
	}
}

// TestWildberriesParser_APIFails_HTMLSucceeds proves the fallback path: REST
// 403s (the failure mode we worry about with a customer-facing site behind a
// CDN), HTML scrape picks up the slack with real data.
func TestWildberriesParser_APIFails_HTMLSucceeds(t *testing.T) {
	t.Parallel()
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "forbidden", http.StatusForbidden)
	}))
	t.Cleanup(apiSrv.Close)
	htmlSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(wbHTMLFallback))
	}))
	t.Cleanup(htmlSrv.Close)

	p := NewWildberries(testLog()).WithAPIURL(apiSrv.URL).WithHTMLURL(htmlSrv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 1 || got[0].Title != "QA Engineer" {
		t.Errorf("want 1xQA from HTML fallback, got %+v", got)
	}
}

func TestWildberriesParser_BothFail(t *testing.T) {
	t.Parallel()
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	t.Cleanup(apiSrv.Close)
	htmlSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<html><body>nothing here</body></html>`))
	}))
	t.Cleanup(htmlSrv.Close)

	p := NewWildberries(testLog()).WithAPIURL(apiSrv.URL).WithHTMLURL(htmlSrv.URL)
	_, err := p.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error when both REST and HTML fail")
	}
}

func TestWildberriesParser_MalformedAPI(t *testing.T) {
	t.Parallel()
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<<not json>>`))
	}))
	t.Cleanup(apiSrv.Close)
	// HTML succeeds — proves malformed REST -> HTML fallback path.
	htmlSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(wbHTMLFallback))
	}))
	t.Cleanup(htmlSrv.Close)

	p := NewWildberries(testLog()).WithAPIURL(apiSrv.URL).WithHTMLURL(htmlSrv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 1 {
		t.Errorf("want 1 vacancy from html fallback after malformed api, got %d", len(got))
	}
}

func TestWildberriesParser_EmptyAPI(t *testing.T) {
	t.Parallel()
	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[]`))
	}))
	t.Cleanup(apiSrv.Close)
	htmlSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(wbHTMLFallback))
	}))
	t.Cleanup(htmlSrv.Close)

	p := NewWildberries(testLog()).WithAPIURL(apiSrv.URL).WithHTMLURL(htmlSrv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	// Empty REST -> falls through to HTML which has 1 row.
	if len(got) != 1 {
		t.Errorf("want 1 from html after empty api, got %d", len(got))
	}
}
