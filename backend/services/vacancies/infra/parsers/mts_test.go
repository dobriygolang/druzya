package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

// mtsFixture is a trimmed copy of the verified production payload from
// https://job.mts.ru/api/v2/vacancies (snapshot 2026-04-23).
const mtsFixture = `{
  "data": [
    {
      "id": 651331801431670900,
      "title": "Релизный менеджер мобильного приложения",
      "slug": "651331801431670850",
      "isActive": true,
      "publishedAt": "2026-04-23T00:00:00.000Z",
      "salaryFrom": null,
      "salaryTo": null,
      "currency": {"title": "RUB"},
      "region": {"title": "Москва"},
      "experience": {"title": "1-3 года"},
      "organization": {"title": "ПАО МТС-Банк"},
      "workFormats": [{"title": "В офисе"}],
      "tasks": [{"title": "Координировать релизы"}],
      "offers": [{"title": "ДМС"}],
      "requirements": [{"title": "Опыт от 1 года"}],
      "tags": [{"title": "Mobile"}, {"title": "Release"}]
    }
  ],
  "meta": {"pagination": {"page": 1, "pageSize": 25, "pageCount": 95, "total": 2363}}
}`

func TestMTSParser_HappyPath(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != scraperUA {
			t.Errorf("missing scraper UA, got %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(mtsFixture))
	}))
	defer srv.Close()

	p := NewMTS(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	v := got[0]
	if v.Source != domain.SourceMTS {
		t.Errorf("source: %q", v.Source)
	}
	if v.ExternalID != "651331801431670900" {
		t.Errorf("external_id: %q", v.ExternalID)
	}
	if v.Company != "ПАО МТС-Банк" {
		t.Errorf("company: %q", v.Company)
	}
	if v.Location != "Москва" {
		t.Errorf("location: %q", v.Location)
	}
	if v.EmploymentType != "В офисе" {
		t.Errorf("employment: %q", v.EmploymentType)
	}
	if v.ExperienceLevel != "1-3 года" {
		t.Errorf("experience: %q", v.ExperienceLevel)
	}
	if v.URL != "https://job.mts.ru/vacancies/651331801431670850" {
		t.Errorf("url: %q", v.URL)
	}
	if !strings.Contains(v.Description, "Координировать релизы") {
		t.Errorf("description: %q", v.Description)
	}
	if v.PostedAt == nil {
		t.Errorf("posted_at nil")
	}
	if !contains(v.RawSkills, "Mobile") {
		t.Errorf("skills: %v", v.RawSkills)
	}
}

func TestMTSParser_HTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	p := NewMTS(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected HTTP error")
	}
}

func TestMTSParser_Malformed(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("garbage"))
	}))
	defer srv.Close()
	p := NewMTS(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected decode error")
	}
}

func TestMTSParser_Empty(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[],"meta":{"pagination":{"total":0}}}`))
	}))
	defer srv.Close()
	p := NewMTS(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("empty should not error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want 0, got %d", len(got))
	}
}
