package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestOzonParser_Fetch_FromFixture(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile("testdata/ozon.html")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	p := NewOzon(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	if got[0].ExternalID != "o-1" || got[0].Company != "Ozon" {
		t.Errorf("mismatch: %+v", got[0])
	}
	if !contains(got[0].NormalizedSkills, "react") || !contains(got[0].NormalizedSkills, "typescript") {
		t.Errorf("missing skills: %+v", got[0].NormalizedSkills)
	}
}
