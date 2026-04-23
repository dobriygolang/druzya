package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

// wbRealResponseFixture is a trimmed copy of the verified production payload
// from https://career.rwb.ru/crm-api/api/v1/pub/vacancies (snapshot
// 2026-04-23). Two items kept — same shape as the live 538-item response.
const wbRealResponseFixture = `{
  "status": 200,
  "data": {
    "items": [
      {
        "id": 30154,
        "name": "Lead System Analyst DWH в команду сервиса Такси",
        "direction_title": "Аналитика",
        "direction_role_title": "System Analyst",
        "experience_type_title": "От 5 лет",
        "city_title": "Москва",
        "employment_types": [
          {"id": 1, "vacancy_id": 30154, "title": "Гибрид", "description": ""}
        ]
      },
      {
        "id": 34295,
        "name": "Network Security Engineer",
        "direction_title": "Информационная безопасность",
        "direction_role_title": "Information Security Engineer",
        "experience_type_title": "От 3 лет",
        "city_title": "Москва",
        "employment_types": [
          {"id": 1, "vacancy_id": 34295, "title": "Гибрид", "description": ""},
          {"id": 2, "vacancy_id": 34295, "title": "Удаленно", "description": ""}
        ]
      }
    ],
    "range": {"total": 538}
  }
}`

func TestWildberriesParser_HappyPath(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != scraperUA {
			t.Errorf("missing scraper UA, got %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(wbRealResponseFixture))
	}))
	defer srv.Close()

	p := NewWildberries(testLog()).WithAPIURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 vacancies, got %d", len(got))
	}
	v := got[0]
	if v.Source != domain.SourceWildberries {
		t.Errorf("source: %q", v.Source)
	}
	if v.ExternalID != "30154" {
		t.Errorf("external_id: %q", v.ExternalID)
	}
	if v.Title != "Lead System Analyst DWH в команду сервиса Такси" {
		t.Errorf("title: %q", v.Title)
	}
	if v.Company != "Wildberries" {
		t.Errorf("company: %q", v.Company)
	}
	if v.Location != "Москва" {
		t.Errorf("location: %q", v.Location)
	}
	if v.EmploymentType != "Гибрид" {
		t.Errorf("employment: %q", v.EmploymentType)
	}
	if v.ExperienceLevel != "От 5 лет" {
		t.Errorf("experience: %q", v.ExperienceLevel)
	}
	if v.URL != "https://career.rwb.ru/vacancies/30154" {
		t.Errorf("url: %q", v.URL)
	}
	if !strings.Contains(v.Description, "Аналитика") {
		t.Errorf("description: %q", v.Description)
	}
	if v.FetchedAt.IsZero() {
		t.Errorf("fetched_at zero")
	}
	if len(v.RawJSON) == 0 {
		t.Errorf("raw_json empty")
	}
	// Second item — multi-employment-type join.
	if got[1].EmploymentType != "Гибрид, Удаленно" {
		t.Errorf("multi-emp: %q", got[1].EmploymentType)
	}
}

func TestWildberriesParser_HTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	p := NewWildberries(testLog()).WithAPIURL(srv.URL)
	_, err := p.Fetch(context.Background())
	if err == nil {
		t.Fatalf("expected error on HTTP 500")
	}
}

func TestWildberriesParser_MalformedBody(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{not json"))
	}))
	defer srv.Close()

	p := NewWildberries(testLog()).WithAPIURL(srv.URL)
	_, err := p.Fetch(context.Background())
	if err == nil {
		t.Fatalf("expected decode error")
	}
}

func TestWildberriesParser_EmptyItems(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":200,"data":{"items":[],"range":{"total":0}}}`))
	}))
	defer srv.Close()

	p := NewWildberries(testLog()).WithAPIURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("empty list should not error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want 0, got %d", len(got))
	}
}
