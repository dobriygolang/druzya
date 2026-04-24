package details

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"druz9/vacancies/domain"
)

const wbDetailFixture = `{"data":{
  "id": 12345,
  "description": "О компании Wildberries…",
  "requirements_arr": ["Опыт от 3 лет", "Знание Go"],
  "duties_arr": ["Разрабатывать сервисы", "Поддерживать legacy"],
  "conditions_arr": ["ДМС", "Гибкий график", ""]
}}`

func TestWBDetail_DecodesFixture(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(wbDetailFixture))
	}))
	defer srv.Close()

	f := NewWB(testLog()).WithBaseURL(srv.URL)
	listing := domain.Vacancy{Source: domain.SourceWildberries, ExternalID: "12345", Company: "WB"}
	d, err := f.FetchDetails(context.Background(), "12345", listing)
	if err != nil {
		t.Fatalf("FetchDetails: %v", err)
	}
	if d.Vacancy.Company != "WB" {
		t.Errorf("listing pass-through lost")
	}
	if d.DescriptionHTML == "" {
		t.Errorf("description empty")
	}
	if len(d.Requirements) != 2 || d.Requirements[1] != "Знание Go" {
		t.Errorf("requirements: %v", d.Requirements)
	}
	if len(d.Duties) != 2 {
		t.Errorf("duties: %v", d.Duties)
	}
	// Empty entries trimmed
	if len(d.Conditions) != 2 {
		t.Errorf("conditions (empties should be dropped): %v", d.Conditions)
	}
}
