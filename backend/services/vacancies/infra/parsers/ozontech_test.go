package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

const ozonTechHappyHTML = `<!doctype html><html><head></head><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"vacancies":[
{"id":"v1","slug":"backend-go","title":"Backend Go Engineer","city":"Москва","employment":"full","url":"https://career.ozon.tech/vacancies/backend-go","description":"Build platform","requirements":"Go, k8s","responsibilities":"Ship features","publishedAt":"2026-04-20T12:00:00+0300","skills":["Go","Kubernetes"]},
{"id":"v2","slug":"frontend-react","title":"Frontend React","city":"Санкт-Петербург","employment":"full","description":"Web UI"}
]}}}</script>
</body></html>`

const ozonTechEmptyHTML = `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"vacancies":[]}}}</script>
</body></html>`

const ozonTechNoBlobHTML = `<!doctype html><html><body><h1>Careers</h1><p>No SSR data here.</p></body></html>`

func TestOzonTechParser_HappyPath(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("User-Agent"); !strings.Contains(got, "druz9-vacancies") {
			t.Errorf("User-Agent missing druz9-vacancies marker: %q", got)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(ozonTechHappyHTML))
	}))
	t.Cleanup(srv.Close)

	p := NewOzonTech(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 vacancies, got %d", len(got))
	}
	if got[0].Source != domain.SourceOzonTech {
		t.Errorf("source: want ozontech, got %s", got[0].Source)
	}
	if got[0].Title != "Backend Go Engineer" || got[0].ExternalID != "v1" {
		t.Errorf("first item mismatch: %+v", got[0])
	}
	if got[0].Company != "Ozon Tech" {
		t.Errorf("company: %q", got[0].Company)
	}
	if got[0].URL != "https://career.ozon.tech/vacancies/backend-go" {
		t.Errorf("url: %q", got[0].URL)
	}
	if got[0].PostedAt == nil {
		t.Errorf("postedAt should be parsed")
	}
	if !contains(got[0].NormalizedSkills, "go") {
		t.Errorf("normalized skills missing go: %v", got[0].NormalizedSkills)
	}
	// Second item has no url — derive from slug.
	if got[1].URL == "" || !strings.Contains(got[1].URL, "frontend-react") {
		t.Errorf("derived url missing: %q", got[1].URL)
	}
}

func TestOzonTechParser_EmptyResponse(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(ozonTechEmptyHTML))
	}))
	t.Cleanup(srv.Close)

	p := NewOzonTech(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("want 0 vacancies on empty list, got %d", len(got))
	}
}

func TestOzonTechParser_MalformedNoBlob(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(ozonTechNoBlobHTML))
	}))
	t.Cleanup(srv.Close)

	p := NewOzonTech(testLog()).WithBaseURL(srv.URL)
	_, err := p.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error when __NEXT_DATA__ blob is missing (anti-fallback)")
	}
	if !strings.Contains(err.Error(), "__NEXT_DATA__") {
		t.Errorf("error should mention __NEXT_DATA__, got: %v", err)
	}
}

func TestOzonTechParser_HTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	p := NewOzonTech(testLog()).WithBaseURL(srv.URL)
	_, err := p.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error on 500")
	}
}
