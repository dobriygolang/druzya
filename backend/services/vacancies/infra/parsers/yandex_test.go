package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestYandexParser_Fetch_FromFixture(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile("testdata/yandex.html")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	p := NewYandex(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	if got[0].ExternalID != "y-1" || got[0].Title != "Backend Developer" {
		t.Errorf("first item mismatch: %+v", got[0])
	}
	if got[0].Company != "Yandex" {
		t.Errorf("company should be Yandex, got %q", got[0].Company)
	}
	if !contains(got[0].NormalizedSkills, "go") || !contains(got[0].NormalizedSkills, "clickhouse") {
		t.Errorf("missing normalized skills: %+v", got[0].NormalizedSkills)
	}
}

func TestYandexParser_NoBlob_ReturnsError(t *testing.T) {
	t.Parallel()
	// fallbacks were removed deliberately — schema surprises propagate.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html><body>plain page</body></html>"))
	}))
	defer srv.Close()

	p := NewYandex(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected error when __NEXT_DATA__ blob is absent, got nil")
	}
}
