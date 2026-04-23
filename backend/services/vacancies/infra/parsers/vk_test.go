package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"druz9/vacancies/domain"
)

// vkFixture is a trimmed copy of the verified production payload from
// https://team.vk.company/career/api/v2/vacancies/ (snapshot 2026-04-23).
const vkFixture = `{
  "count": 306,
  "next": "https://team.vk.company/career/api/v2/vacancies/?limit=10&offset=10",
  "previous": null,
  "results": [
    {
      "id": 45215,
      "title": "Специалист по эксплуатации",
      "prof_area": {"id": 41, "name": "Внутренние сервисы"},
      "group": {"id": 135, "name": "VK"},
      "town": {"id": 1, "name": "Москва"},
      "work_format": "офисный",
      "tags": [{"id": 2503, "name": "administrative"}],
      "remote": false,
      "specialty": {"id": 289, "name": "Административный персонал"}
    },
    {
      "id": 45216,
      "title": "Senior Backend",
      "prof_area": {"id": 1, "name": "Разработка"},
      "group": {"id": 200, "name": "VK Tech"},
      "town": {"id": 1, "name": "Москва"},
      "work_format": "гибрид",
      "tags": [{"id": 1, "name": "Go"}, {"id": 2, "name": "PostgreSQL"}],
      "remote": true,
      "specialty": {"id": 5, "name": "Backend"}
    }
  ]
}`

func TestVKParser_HappyPath(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != scraperUA {
			t.Errorf("missing scraper UA, got %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(vkFixture))
	}))
	defer srv.Close()

	p := NewVK(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	v := got[0]
	if v.Source != domain.SourceVK {
		t.Errorf("source: %q", v.Source)
	}
	if v.ExternalID != "45215" {
		t.Errorf("external_id: %q", v.ExternalID)
	}
	if v.Title != "Специалист по эксплуатации" {
		t.Errorf("title: %q", v.Title)
	}
	if v.Company != "VK" {
		t.Errorf("company: %q", v.Company)
	}
	if v.Location != "Москва" {
		t.Errorf("location: %q", v.Location)
	}
	if v.EmploymentType != "офисный" {
		t.Errorf("employment: %q", v.EmploymentType)
	}
	if v.URL != "https://team.vk.company/vacancy/45215/" {
		t.Errorf("url: %q", v.URL)
	}
	// Second item — remote=true should append "удалённо".
	if got[1].EmploymentType != "гибрид, удалённо" {
		t.Errorf("remote suffix missing: %q", got[1].EmploymentType)
	}
	if got[1].Company != "VK Tech" {
		t.Errorf("group fallback: %q", got[1].Company)
	}
	if !contains(got[1].RawSkills, "Go") {
		t.Errorf("tags as skills: %v", got[1].RawSkills)
	}
}

func TestVKParser_HTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	p := NewVK(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected HTTP error")
	}
}

func TestVKParser_Malformed(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("oops"))
	}))
	defer srv.Close()
	p := NewVK(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected decode error")
	}
}

func TestVKParser_EmptyResults(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"count":0,"results":[]}`))
	}))
	defer srv.Close()
	p := NewVK(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("empty should not error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want 0, got %d", len(got))
	}
}
