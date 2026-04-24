package details

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

const mtsDetailFixture = `{"data":{
  "id": 651331801431670900,
  "slug": "release-manager-mobile",
  "description": "Релизный менеджер мобильного приложения",
  "detailText": "<p>Подробное описание</p><ul><li>пункт 1</li></ul>",
  "info": "info text",
  "tasks": [
    {"id":1,"title":"Координировать релизы","description":"Координировать релизы"},
    {"id":2,"title":"Согласовывать сроки","description":"Согласовывать сроки"}
  ],
  "requirements": [
    {"id":1,"title":"Опыт от 1 года","description":"Опыт от 1 года"}
  ],
  "offers": [
    {"id":1,"title":"ДМС","description":"ДМС"},
    {"id":2,"title":"Корпоративные скидки","description":"Корпоративные скидки"}
  ]
}}`

func TestMTSDetail_DecodesFixture(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/release-manager-mobile") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(mtsDetailFixture))
	}))
	defer srv.Close()

	f := NewMTS(testLog()).WithBaseURL(srv.URL)
	listing := domain.Vacancy{
		Source: domain.SourceMTS, ExternalID: "651331801431670900",
		DetailsKey: "release-manager-mobile",
		Company:    "ПАО МТС-Банк",
	}
	d, err := f.FetchDetails(context.Background(), "651331801431670900", listing)
	if err != nil {
		t.Fatalf("FetchDetails: %v", err)
	}
	if d.Vacancy.Company != "ПАО МТС-Банк" {
		t.Errorf("listing pass-through lost")
	}
	if !strings.Contains(d.DescriptionHTML, "Подробное описание") {
		t.Errorf("description: %q", d.DescriptionHTML)
	}
	if len(d.Duties) != 2 || d.Duties[0] != "Координировать релизы" {
		t.Errorf("duties: %v", d.Duties)
	}
	if len(d.Requirements) != 1 {
		t.Errorf("requirements: %v", d.Requirements)
	}
	if len(d.Conditions) != 2 {
		t.Errorf("conditions (offers): %v", d.Conditions)
	}
}

func TestMTSDetail_MissingSlugErrors(t *testing.T) {
	t.Parallel()
	f := NewMTS(testLog())
	listing := domain.Vacancy{Source: domain.SourceMTS, ExternalID: "1"}
	_, err := f.FetchDetails(context.Background(), "1", listing)
	if err == nil {
		t.Fatalf("expected anti-fallback error on missing slug")
	}
}
