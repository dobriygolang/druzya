package ports

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"druz9/ai_native/domain"

	"github.com/google/uuid"
)

// fakeLLMModelRepo is an in-memory stand-in for domain.LLMModelRepo. It
// mirrors just enough behaviour for the public /ai/models + admin CRUD
// tests — real Postgres semantics are exercised by infra integration
// tests run separately.
type fakeLLMModelRepo struct {
	rows    []domain.LLMModel
	listErr error
}

func (r *fakeLLMModelRepo) List(_ context.Context, f domain.LLMModelFilter) ([]domain.LLMModel, error) {
	if r.listErr != nil {
		return nil, r.listErr
	}
	out := make([]domain.LLMModel, 0, len(r.rows))
	for _, m := range r.rows {
		if f.OnlyEnabled && !m.IsEnabled {
			continue
		}
		switch f.Use {
		case domain.LLMModelUseArena:
			if !m.UseForArena {
				continue
			}
		case domain.LLMModelUseInsight:
			if !m.UseForInsight {
				continue
			}
		case domain.LLMModelUseMock:
			if !m.UseForMock {
				continue
			}
		case domain.LLMModelUseVacancies:
			if !m.UseForVacancies {
				continue
			}
		}
		out = append(out, m)
	}
	return out, nil
}

func (r *fakeLLMModelRepo) GetByID(_ context.Context, id string) (domain.LLMModel, error) {
	for _, m := range r.rows {
		if m.ModelID == id {
			return m, nil
		}
	}
	return domain.LLMModel{}, domain.ErrLLMModelNotFound
}

func (r *fakeLLMModelRepo) Create(_ context.Context, m domain.LLMModel) (domain.LLMModel, error) {
	for _, existing := range r.rows {
		if existing.ModelID == m.ModelID {
			return domain.LLMModel{}, domain.ErrLLMModelConflict
		}
	}
	m.ID = int64(len(r.rows) + 1)
	r.rows = append(r.rows, m)
	return m, nil
}

func (r *fakeLLMModelRepo) Update(_ context.Context, id string, m domain.LLMModel) (domain.LLMModel, error) {
	for i, existing := range r.rows {
		if existing.ModelID == id {
			m.ID = existing.ID
			r.rows[i] = m
			return m, nil
		}
	}
	return domain.LLMModel{}, domain.ErrLLMModelNotFound
}

func (r *fakeLLMModelRepo) Delete(_ context.Context, id string) error {
	for i, existing := range r.rows {
		if existing.ModelID == id {
			r.rows = append(r.rows[:i], r.rows[i+1:]...)
			return nil
		}
	}
	return domain.ErrLLMModelNotFound
}

func (r *fakeLLMModelRepo) SetEnabled(_ context.Context, id string, enabled bool) error {
	for i, existing := range r.rows {
		if existing.ModelID == id {
			r.rows[i].IsEnabled = enabled
			return nil
		}
	}
	return domain.ErrLLMModelNotFound
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func seededRepo() *fakeLLMModelRepo {
	return &fakeLLMModelRepo{rows: []domain.LLMModel{
		{
			ID: 1, ModelID: "openai/gpt-4o-mini", Label: "GPT-4o mini",
			Provider: "openai", Tier: domain.LLMModelTierFree, IsEnabled: true,
			UseForArena: true, UseForInsight: true, UseForMock: true, SortOrder: 10,
		},
		{
			ID: 2, ModelID: "openai/gpt-4o", Label: "GPT-4o",
			Provider: "openai", Tier: domain.LLMModelTierPremium, IsEnabled: true,
			UseForArena: true, UseForInsight: true, UseForMock: true, SortOrder: 20,
		},
		{
			ID: 3, ModelID: "anthropic/claude-sonnet-4", Label: "Claude Sonnet 4",
			Provider: "anthropic", Tier: domain.LLMModelTierPremium, IsEnabled: false,
			UseForArena: true, UseForInsight: true, UseForMock: true, SortOrder: 30,
		},
	}}
}

func TestModelsHandler_NoKey_ReturnsEmpty(t *testing.T) {
	t.Parallel()
	h := NewModelsHandler(false, seededRepo(), nil, discardLogger())
	rec := httptest.NewRecorder()
	h.handleList(rec, httptest.NewRequest(http.MethodGet, "/ai/models", nil))
	var resp ModelsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Available {
		t.Errorf("Available = true, want false")
	}
	if len(resp.Items) != 0 {
		t.Errorf("items should be empty when key missing, got %d", len(resp.Items))
	}
}

func TestModelsHandler_KeyPresent_FiltersDisabledAndPremium(t *testing.T) {
	t.Parallel()
	h := NewModelsHandler(true, seededRepo(), nil, discardLogger())
	rec := httptest.NewRecorder()
	h.handleList(rec, httptest.NewRequest(http.MethodGet, "/ai/models", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp ModelsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Available {
		t.Errorf("Available = false, want true")
	}
	// Users=nil → free-only. Only the gpt-4o-mini row is free+enabled.
	if len(resp.Items) != 1 || resp.Items[0].ID != "openai/gpt-4o-mini" {
		t.Fatalf("want single free model, got %+v", resp.Items)
	}
	if resp.Items[0].Tier != "free" {
		t.Errorf("tier = %q", resp.Items[0].Tier)
	}
}

func TestModelsHandler_InvalidUseQuery_Rejected(t *testing.T) {
	t.Parallel()
	h := NewModelsHandler(true, seededRepo(), nil, discardLogger())
	rec := httptest.NewRecorder()
	h.handleList(rec, httptest.NewRequest(http.MethodGet, "/ai/models?use=bogus", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

// Admin endpoint smoke tests — role gate bypassed by injecting the
// context values the middleware normally writes.
func withAdminCtx(r *http.Request) *http.Request {
	// The real middleware package is imported by the handler but we
	// can't call its setters (unexported). We exercise the happy path
	// by delegating to the actual middleware contract via a thin
	// helper exported for tests — see admin_models_test_helpers.go.
	return attachAdminForTest(r, uuid.New())
}

func TestAdminModelsHandler_Create_Then_List(t *testing.T) {
	t.Parallel()
	repo := &fakeLLMModelRepo{}
	h := NewAdminModelsHandler(repo, discardLogger())

	body := `{"model_id":"x/y","label":"X-Y","provider":"x","tier":"free"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/ai/models", strPayload(body))
	h.create(rec, withAdminCtx(req))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.list(rec, withAdminCtx(httptest.NewRequest(http.MethodGet, "/admin/ai/models", nil)))
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	var resp adminModelsListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Items) != 1 || resp.Items[0].ModelID != "x/y" {
		t.Errorf("got %+v", resp.Items)
	}
}

func TestAdminModelsHandler_Create_DuplicateConflict(t *testing.T) {
	t.Parallel()
	repo := seededRepo()
	h := NewAdminModelsHandler(repo, discardLogger())
	rec := httptest.NewRecorder()
	body := `{"model_id":"openai/gpt-4o-mini","label":"dup","provider":"openai","tier":"free"}`
	h.create(rec, withAdminCtx(httptest.NewRequest(http.MethodPost, "/admin/ai/models", strPayload(body))))
	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", rec.Code)
	}
}

func TestAdminModelsHandler_Unauthenticated_Rejected(t *testing.T) {
	t.Parallel()
	h := NewAdminModelsHandler(seededRepo(), discardLogger())
	rec := httptest.NewRecorder()
	h.list(rec, httptest.NewRequest(http.MethodGet, "/admin/ai/models", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}
