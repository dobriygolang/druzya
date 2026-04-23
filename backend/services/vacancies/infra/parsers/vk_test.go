package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestVKParser_Fetch_FromFixture(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile("testdata/vk.html")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	p := NewVK(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	if got[0].Company != "VK" || got[0].Title != "Mobile Developer" {
		t.Errorf("mismatch: %+v", got[0])
	}
	if !contains(got[0].NormalizedSkills, "swift") {
		t.Errorf("missing swift: %+v", got[0].NormalizedSkills)
	}
}
