// admin_ai_models.go — chi-direct admin CRUD over `llm_models`.
package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	adminApp "druz9/admin/app"
	adminDomain "druz9/admin/domain"
	adminInfra "druz9/admin/infra"
	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"

	"github.com/go-chi/chi/v5"
)

type adminLLMModelDTO struct {
	ID                int64    `json:"id"`
	ModelID           string   `json:"model_id"`
	Label             string   `json:"label"`
	Provider          string   `json:"provider"`
	Tier              string   `json:"tier"`
	IsEnabled         bool     `json:"is_enabled"`
	ContextWindow     *int     `json:"context_window"`
	CostPerKInputUSD  *float64 `json:"cost_per_1k_input_usd"`
	CostPerKOutputUSD *float64 `json:"cost_per_1k_output_usd"`
	UseForArena       bool     `json:"use_for_arena"`
	UseForInsight     bool     `json:"use_for_insight"`
	UseForMock        bool     `json:"use_for_mock"`
	SortOrder         int      `json:"sort_order"`
	CreatedAt         string   `json:"created_at"`
	UpdatedAt         string   `json:"updated_at"`
}

func dtoFromAIModel(m adminDomain.AIModel) adminLLMModelDTO {
	return adminLLMModelDTO{
		ID: m.ID, ModelID: m.ModelID, Label: m.Label, Provider: m.Provider,
		Tier: m.Tier, IsEnabled: m.IsEnabled,
		ContextWindow: m.ContextWindow, CostPerKInputUSD: m.CostPerKInputUSD,
		CostPerKOutputUSD: m.CostPerKOutputUSD,
		UseForArena:       m.UseForArena, UseForInsight: m.UseForInsight, UseForMock: m.UseForMock,
		SortOrder: m.SortOrder, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
}

// NewAdminAIModels wires the admin write surface for the LLM model
// catalogue. Returns a Module so it slots into the standard bootstrap
// loop.
func NewAdminAIModels(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewAIModels(d.Pool)
	h := &adminAIModelsHandler{
		list:   &adminApp.ListAIModels{Models: repo},
		create: &adminApp.CreateAIModel{Models: repo},
		update: &adminApp.UpdateAIModel{Models: repo},
		toggle: &adminApp.ToggleAIModel{Models: repo},
		delete: &adminApp.DeleteAIModel{Models: repo},
		log:    d.Log,
	}
	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			r.Get("/admin/ai/models", h.handleList)
			r.Post("/admin/ai/models", h.handleCreate)
			r.Patch("/admin/ai/models/{model_id}", h.handleUpdate)
			r.Patch("/admin/ai/models/{model_id}/toggle", h.handleToggle)
			r.Delete("/admin/ai/models/{model_id}", h.handleDelete)
		},
	}
}

type adminAIModelsHandler struct {
	list   *adminApp.ListAIModels
	create *adminApp.CreateAIModel
	update *adminApp.UpdateAIModel
	toggle *adminApp.ToggleAIModel
	delete *adminApp.DeleteAIModel
	log    *slog.Logger
}

func (h *adminAIModelsHandler) handleList(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	rows, err := h.list.Do(r.Context())
	if err != nil {
		h.fail(w, r, err, "list")
		return
	}
	out := make([]adminLLMModelDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, dtoFromAIModel(row))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

type adminLLMModelUpsertBody struct {
	ModelID           string   `json:"model_id"`
	Label             string   `json:"label"`
	Provider          string   `json:"provider"`
	Tier              string   `json:"tier"`
	IsEnabled         *bool    `json:"is_enabled,omitempty"`
	ContextWindow     *int     `json:"context_window"`
	CostPerKInputUSD  *float64 `json:"cost_per_1k_input_usd"`
	CostPerKOutputUSD *float64 `json:"cost_per_1k_output_usd"`
	UseForArena       *bool    `json:"use_for_arena,omitempty"`
	UseForInsight     *bool    `json:"use_for_insight,omitempty"`
	UseForMock        *bool    `json:"use_for_mock,omitempty"`
	SortOrder         *int     `json:"sort_order,omitempty"`
}

func (b adminLLMModelUpsertBody) toUpsert() adminDomain.AIModelUpsert {
	return adminDomain.AIModelUpsert{
		ModelID: b.ModelID, Label: b.Label, Provider: b.Provider, Tier: b.Tier,
		IsEnabled:         b.IsEnabled,
		ContextWindow:     b.ContextWindow,
		CostPerKInputUSD:  b.CostPerKInputUSD,
		CostPerKOutputUSD: b.CostPerKOutputUSD,
		UseForArena:       b.UseForArena,
		UseForInsight:     b.UseForInsight,
		UseForMock:        b.UseForMock,
		SortOrder:         b.SortOrder,
	}
}

func (h *adminAIModelsHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	var body adminLLMModelUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	out, err := h.create.Do(r.Context(), body.toUpsert())
	if err != nil {
		if errors.Is(err, adminDomain.ErrInvalidInput) {
			http.Error(w, `{"error":"model_id, label, provider required"}`, http.StatusBadRequest)
			return
		}
		h.fail(w, r, err, "create")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(dtoFromAIModel(out))
}

func (h *adminAIModelsHandler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	modelID := chi.URLParam(r, "model_id")
	if modelID == "" {
		http.Error(w, `{"error":"model_id required"}`, http.StatusBadRequest)
		return
	}
	var body adminLLMModelUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	out, err := h.update.Do(r.Context(), modelID, body.toUpsert())
	if err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		if errors.Is(err, adminDomain.ErrInvalidInput) {
			http.Error(w, `{"error":"model_id required"}`, http.StatusBadRequest)
			return
		}
		h.fail(w, r, err, "update")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dtoFromAIModel(out))
}

func (h *adminAIModelsHandler) handleToggle(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	modelID := chi.URLParam(r, "model_id")
	out, err := h.toggle.Do(r.Context(), modelID)
	if err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "toggle")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dtoFromAIModel(out))
}

func (h *adminAIModelsHandler) handleDelete(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	modelID := chi.URLParam(r, "model_id")
	if err := h.delete.Do(r.Context(), modelID); err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "delete")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *adminAIModelsHandler) fail(w http.ResponseWriter, r *http.Request, err error, op string) {
	if h.log != nil {
		h.log.ErrorContext(r.Context(), "admin.ai_models: "+op+" failed", slog.Any("err", err))
	}
	http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
}
