package parsers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

// ozonFixture is a trimmed copy of the verified production payload from
// https://job-ozon-api.t.o3.ru/v2/vacancy (snapshot 2026-04-23, sample
// shared by user — sandbox can't reach the host directly due to JA3/geo).
const ozonFixture = `{"items":[
  {"hhId":130283769,
   "internalUuid":"058569d9-e042-4bbe-ac30-a8a4c1184f7e",
   "department":"Ozon Офис и Коммерция",
   "employment":"Полная",
   "experience":"От 3 до 6 лет",
   "workFormat":["Гибрид"],
   "title":"Data Engineer",
   "city":"Москва",
   "professionalRoles":[{"ID":"156","title":"BI-аналитик, аналитик данных"}],
   "vacancyType":"external_vacancy"},
  {"hhId":0,
   "internalUuid":"e12f70d6-1a3e-4e1a-949f-1c64aa138be3",
   "department":"Ozon Tech",
   "employment":"Полная",
   "experience":"От 1 года до 3 лет",
   "workFormat":["Удалённо","Гибрид"],
   "title":"Backend Developer",
   "city":"Москва",
   "professionalRoles":[{"ID":"96","title":"Программист, разработчик"}],
   "vacancyType":"external_vacancy"}
]}`

func TestOzonParser_HappyPath(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != ozonOrigin {
			t.Errorf("missing Origin header, got %q", r.Header.Get("Origin"))
		}
		if r.Header.Get("User-Agent") != scraperUA {
			t.Errorf("missing scraper UA, got %q", r.Header.Get("User-Agent"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(ozonFixture))
	}))
	defer srv.Close()

	p := NewOzon(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	v := got[0]
	if v.Source != domain.SourceOzon {
		t.Errorf("source: %q", v.Source)
	}
	if v.ExternalID != "058569d9-e042-4bbe-ac30-a8a4c1184f7e" {
		t.Errorf("external_id: %q", v.ExternalID)
	}
	if v.Title != "Data Engineer" {
		t.Errorf("title: %q", v.Title)
	}
	if v.Company != "Ozon" {
		t.Errorf("company: %q", v.Company)
	}
	if v.Location != "Москва" {
		t.Errorf("location: %q", v.Location)
	}
	if v.EmploymentType != "Полная, Гибрид" {
		t.Errorf("employment: %q", v.EmploymentType)
	}
	if v.ExperienceLevel != "От 3 до 6 лет" {
		t.Errorf("experience: %q", v.ExperienceLevel)
	}
	if v.URL != "https://career.ozon.ru/vacancy/058569d9-e042-4bbe-ac30-a8a4c1184f7e" {
		t.Errorf("url: %q", v.URL)
	}
	if !strings.Contains(v.Description, "BI-аналитик") {
		t.Errorf("description: %q", v.Description)
	}
	if !strings.Contains(v.Description, "hh#130283769") {
		t.Errorf("hhId breadcrumb missing: %q", v.Description)
	}
	// Second item — multi-workFormat join, no hhId breadcrumb.
	if got[1].EmploymentType != "Полная, Удалённо, Гибрид" {
		t.Errorf("multi work format: %q", got[1].EmploymentType)
	}
	if strings.Contains(got[1].Description, "hh#") {
		t.Errorf("hhId breadcrumb should be absent for hhId=0: %q", got[1].Description)
	}
}

func TestOzonParser_HTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	p := NewOzon(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected HTTP error")
	}
}

func TestOzonParser_Malformed(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not json"))
	}))
	defer srv.Close()
	p := NewOzon(testLog()).WithBaseURL(srv.URL)
	if _, err := p.Fetch(context.Background()); err == nil {
		t.Fatalf("expected decode error")
	}
}

func TestOzonParser_Empty(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"items":[]}`))
	}))
	defer srv.Close()
	p := NewOzon(testLog()).WithBaseURL(srv.URL)
	got, err := p.Fetch(context.Background())
	if err != nil {
		t.Fatalf("empty should not error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("want 0, got %d", len(got))
	}
}
