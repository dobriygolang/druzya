package details

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

func testLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// yandexDetailFixture mirrors the verified production payload (snapshot
// 2026-04-23) — top-level object, all rich fields HTML strings.
const yandexDetailFixture = `{
  "id": 15322,
  "description": "<p>Команда ищет инженера</p>",
  "key_qualifications": "<ul><li>Go от 3 лет</li><li>PostgreSQL</li></ul>",
  "additional_requirements": "<ul><li>K8s</li></ul>",
  "duties": "<ul><li>Писать код</li><li>Ревьюить PR</li></ul>",
  "conditions": "<ul><li>ДМС</li><li>Оборудование</li></ul>",
  "our_team": "<p>Маленькая дружная команда из 8 человек.</p>",
  "tech_stack": "<ul><li>Go</li><li>K8s</li><li>Kafka</li></ul>"
}`

func TestYandexDetail_DecodesFixture(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/15322") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(yandexDetailFixture))
	}))
	defer srv.Close()

	f := NewYandex(testLog()).WithBaseURL(srv.URL)
	listing := domain.Vacancy{Source: domain.SourceYandex, ExternalID: "15322", Title: "Backend"}
	d, err := f.FetchDetails(context.Background(), "15322", listing)
	if err != nil {
		t.Fatalf("FetchDetails: %v", err)
	}
	if d.Vacancy.Title != "Backend" {
		t.Errorf("listing pass-through lost: %q", d.Vacancy.Title)
	}
	if !strings.Contains(d.DescriptionHTML, "ищет инженера") {
		t.Errorf("description: %q", d.DescriptionHTML)
	}
	if len(d.Duties) != 2 || d.Duties[0] != "Писать код" {
		t.Errorf("duties: %v", d.Duties)
	}
	// Requirements = key_qualifications ∪ additional_requirements
	if len(d.Requirements) != 3 {
		t.Errorf("requirements count: %v", d.Requirements)
	}
	if len(d.Conditions) != 2 {
		t.Errorf("conditions: %v", d.Conditions)
	}
	if !strings.Contains(d.OurTeam, "дружная команда") {
		t.Errorf("our_team: %q", d.OurTeam)
	}
	if len(d.TechStack) != 3 {
		t.Errorf("tech_stack: %v", d.TechStack)
	}
}

func TestYandexDetail_HTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	f := NewYandex(testLog()).WithBaseURL(srv.URL)
	if _, err := f.FetchDetails(context.Background(), "1", domain.Vacancy{}); err == nil {
		t.Fatalf("expected error")
	}
}
