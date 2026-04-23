package parsers

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

// testLog returns an explicit discard logger for unit tests. Constructors
// now panic on nil log (anti-fallback policy).
func testLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestHHParser_Fetch_FromFixture(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile("testdata/hh_search.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/vacancies") {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("missing User-Agent header")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	p := NewHH(testLog()).WithBaseURL(srv.URL).WithMaxPages(1)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 vacancies, got %d", len(got))
	}
	if got[0].Source != domain.SourceHH {
		t.Errorf("source: want hh, got %s", got[0].Source)
	}
	if got[0].ExternalID != "12345" || got[0].Title != "Go Developer" {
		t.Errorf("first item mismatch: %+v", got[0])
	}
	if got[0].Company != "Acme Corp" || got[0].Location != "Москва" {
		t.Errorf("company/location mismatch: %+v", got[0])
	}
	if got[0].SalaryMin != 200000 || got[0].SalaryMax != 350000 || got[0].Currency != "RUR" {
		t.Errorf("salary mismatch: %+v", got[0])
	}
	if !contains(got[0].NormalizedSkills, "go") || !contains(got[0].NormalizedSkills, "postgresql") {
		t.Errorf("normalized skills missing go/postgresql: %+v", got[0].NormalizedSkills)
	}
	if got[0].PostedAt == nil {
		t.Errorf("posted_at not parsed")
	}
}

func TestHHParser_FetchOne_FromFixture(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile("testdata/hh_one.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/vacancies/55555") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	p := NewHH(testLog()).WithBaseURL(srv.URL)
	v, err := p.FetchOne(context.Background(), "https://hh.ru/vacancy/55555")
	if err != nil {
		t.Fatalf("FetchOne: %v", err)
	}
	if v.ExternalID != "55555" || v.Title != "Senior Go Engineer" {
		t.Errorf("mismatch: %+v", v)
	}
	if !strings.Contains(v.Description, "Senior Go Engineer") {
		t.Errorf("description should be HTML-stripped and contain 'Senior Go Engineer': %q", v.Description)
	}
	if strings.Contains(v.Description, "<p>") {
		t.Errorf("description should not contain HTML: %q", v.Description)
	}
}

func TestExtractHHIDFromURL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"https://hh.ru/vacancy/12345", "12345", false},
		{"https://hh.ru/vacancy/12345?from=email", "12345", false},
		{"https://spb.hh.ru/vacancy/99999/", "99999", false},
		{"https://hh.ru/employer/123", "", true},
		{"not a url at all", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := extractHHIDFromURL(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("want %q, got %q", tc.want, got)
			}
		})
	}
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
