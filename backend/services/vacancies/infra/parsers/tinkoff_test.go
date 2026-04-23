package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestTinkoffParser_Fetch_FromFixture(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile("testdata/tinkoff.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	p := NewTinkoff(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	if got[0].ExternalID != "t-1" || got[0].Company != "T-Bank" {
		t.Errorf("mismatch: %+v", got[0])
	}
	if !contains(got[0].NormalizedSkills, "java") || !contains(got[0].NormalizedSkills, "kafka") {
		t.Errorf("missing skills: %+v", got[0].NormalizedSkills)
	}
	if !contains(got[1].NormalizedSkills, "kubernetes") {
		t.Errorf("k8s should be in second item: %+v", got[1].NormalizedSkills)
	}
}

func TestTinkoffParser_Non2xx_ReturnsError(t *testing.T) {
	t.Parallel()
	// fallbacks were removed deliberately — non-2xx propagates.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	p := NewTinkoff(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected error on 5xx, got nil")
	}
}
