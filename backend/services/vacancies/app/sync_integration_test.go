// sync_integration_test.go — black-box "sync runs against a fake HH.ru,
// vacancies land in the catalogue" guarantee.
//
// Pre-existing tests use stub parsers that hand domain.Vacancy directly to
// the SyncJob. That confirms the upsert path but skips the parser surface
// where the real-world bug lives (HTTP, JSON shape, query params). This test
// uses the actual HH parser pointed at httptest.NewServer to prove that:
//
//  1. SyncJob.RunOnce does NOT silently swallow a parser-emitted batch,
//  2. ListVacancies.Do with an empty filter surfaces every upserted row,
//  3. the HH client builds a query with the expected params (text=, area=).
//
// Reproduces the user-visible failure mode "ни одной вакансии так и не вышло"
// from the production ticket — if the integration ever regresses, this test
// goes red instead of waiting for an angry human.
package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"druz9/vacancies/domain"
	"druz9/vacancies/infra/parsers"
)

func TestSyncJob_HHParser_EndToEnd_PopulatesCatalogue(t *testing.T) {
	t.Parallel()

	// Fake HH endpoint: respond to /vacancies with five fully-shaped items.
	// The parser will hit the URL once per page; we cap pages at 1 so a
	// single response is enough.
	resp := map[string]any{
		"page":     0,
		"pages":    1,
		"per_page": 5,
		"found":    5,
		"items":    fakeHHItems(5),
	}
	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal fake response: %v", err)
	}

	var sawText, sawArea bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/vacancies") {
			http.NotFound(w, r)
			return
		}
		// Sanity-check the parser is still passing the params we expect — if
		// somebody silently drops text= or area= the bug from production
		// recurs (HH returns either a 400 or an empty page).
		q := r.URL.Query()
		if q.Get("text") != "" {
			sawText = true
		}
		if q.Get("area") != "" {
			sawArea = true
		}
		if ua := r.Header.Get("User-Agent"); ua == "" {
			t.Errorf("HH parser must send User-Agent (politeness rule)")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	hh := parsers.NewHH(testLog()).WithBaseURL(srv.URL).WithMaxPages(1)
	repo := newMemRepo()

	job := &SyncJob{
		Parsers:          []domain.Parser{hh},
		Repo:             repo,
		Log:              testLog(),
		PerSourceTimeout: 5 * time.Second,
	}
	job.RunOnce(context.Background())

	if !sawText || !sawArea {
		t.Errorf("HH client lost a query param: text=%v area=%v", sawText, sawArea)
	}
	if len(repo.store) != 5 {
		t.Fatalf("repo size = %d, want 5 (sync silently dropped parser output)", len(repo.store))
	}

	// "Empty filter must return everything" is the exact assumption the
	// frontend makes on first page load — if this regresses the user lands
	// on an empty catalogue even with rows in the DB.
	list := &ListVacancies{Repo: repo}
	page, err := list.Do(context.Background(), domain.ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if page.Total != 5 || len(page.Items) != 5 {
		t.Fatalf("page total=%d items=%d, want 5/5", page.Total, len(page.Items))
	}
	for _, v := range page.Items {
		if v.Source != domain.SourceHH {
			t.Errorf("vacancy source = %s, want hh", v.Source)
		}
		if v.Title == "" || v.ExternalID == "" {
			t.Errorf("vacancy missing required fields: %+v", v)
		}
	}
}

// fakeHHItems returns n minimally-valid HH search-result items. Mirrors the
// shape consumed by hhapi.VacancyShort.
func fakeHHItems(n int) []map[string]any {
	out := make([]map[string]any, 0, n)
	for i := 0; i < n; i++ {
		id := strconv.Itoa(i + 1)
		out = append(out, map[string]any{
			"id":            id,
			"name":          "Go Engineer #" + id,
			"alternate_url": "https://hh.ru/vacancy/" + id,
			"published_at":  "2026-04-20T12:00:00+0300",
			"snippet":       map[string]any{"requirement": "Go, PG", "responsibility": "Backend"},
			"salary":        map[string]any{"from": 200000, "to": 350000, "currency": "RUR"},
			"area":          map[string]any{"name": "Москва"},
			"employer":      map[string]any{"name": "Acme"},
			"schedule":      map[string]any{"name": "fullDay"},
			"experience":    map[string]any{"name": "between1And3"},
			"key_skills":    []map[string]string{{"name": "Go"}, {"name": "PostgreSQL"}},
		})
	}
	return out
}
