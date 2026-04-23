package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"druz9/vacancies/domain"
)

// yandexFixture is a trimmed copy of the verified production payload from
// https://yandex.ru/jobs/api/publications (snapshot 2026-04-23).
const yandexFixture = `{
  "count": 1364,
  "next": "http://femida.yandex-team.ru/_api/jobs/publications/?cursor=bz0xOSZwPTM%3D&page_size=20",
  "previous": null,
  "results": [
    {
      "id": 15322,
      "publication_slug_url": "multitrack-_-noviy-format-nayma-dlya-opitnih-bekenderov-15322",
      "title": "Multitrack — новый формат найма",
      "short_summary": "Серия weekend-офферов для бэкенд-разработчиков.",
      "vacancy": {
        "cities": [
          {"id": 2, "name": "Санкт-Петербург", "slug": "saint-petersburg"},
          {"id": 1, "name": "Москва", "slug": "moscow"}
        ],
        "skills": [
          {"id": 34, "name": "Python"},
          {"id": 74, "name": "Go"}
        ],
        "work_modes": [
          {"id": 3, "name": "Гибридный", "slug": "mixed"}
        ]
      },
      "public_service": {"name": "Общие сервисы Яндекса"}
    }
  ]
}`

func TestYandexParser_HappyPath(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != scraperUA {
			t.Errorf("missing scraper UA, got %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(yandexFixture))
	}))
	defer srv.Close()

	p := NewYandex(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	v := got[0]
	if v.Source != domain.SourceYandex {
		t.Errorf("source: %q", v.Source)
	}
	if v.ExternalID != "15322" {
		t.Errorf("external_id: %q", v.ExternalID)
	}
	if v.Company != "Yandex" {
		t.Errorf("company: %q", v.Company)
	}
	if v.Location != "Санкт-Петербург, Москва" {
		t.Errorf("location: %q", v.Location)
	}
	if v.EmploymentType != "Гибридный" {
		t.Errorf("employment: %q", v.EmploymentType)
	}
	wantURL := "https://yandex.ru/jobs/vacancies/multitrack-_-noviy-format-nayma-dlya-opitnih-bekenderov-15322"
	if v.URL != wantURL {
		t.Errorf("url: %q", v.URL)
	}
	if !contains(v.RawSkills, "Go") {
		t.Errorf("skills: %v", v.RawSkills)
	}
}

func TestYandexParser_HTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	p := NewYandex(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected HTTP error")
	}
}

func TestYandexParser_Malformed(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not json"))
	}))
	defer srv.Close()
	p := NewYandex(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected decode error")
	}
}

func TestYandexParser_EmptyResults(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"count":0,"results":[]}`))
	}))
	defer srv.Close()
	p := NewYandex(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("empty should not error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want 0, got %d", len(got))
	}
}
