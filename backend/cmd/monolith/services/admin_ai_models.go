// admin_ai_models.go — chi-direct admin CRUD over `llm_models`.
//
// The public `/api/v1/ai/models` (services/ai_models.go) is a thin
// read-through; this file owns the admin write side: list-with-disabled
// rows, create / patch / toggle / delete. Frontend lives at
// frontend/src/pages/admin/AIModelsPanel.tsx and was previously
// hidden because the backend admin endpoints didn't exist.
package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

const adminLLMModelCols = `
	id, model_id, label, provider, tier, is_enabled,
	context_window, cost_per_1k_input_usd, cost_per_1k_output_usd,
	use_for_arena, use_for_insight, use_for_mock, sort_order,
	to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

// NewAdminAIModels wires the admin write surface for the LLM model
// catalogue. Returns a Module so it slots into the standard bootstrap
// loop.
func NewAdminAIModels(d Deps) *Module {
	h := &adminAIModelsHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Get("/admin/ai/models", h.list)
			r.Post("/admin/ai/models", h.create)
			r.Patch("/admin/ai/models/{model_id}", h.update)
			r.Patch("/admin/ai/models/{model_id}/toggle", h.toggle)
			r.Delete("/admin/ai/models/{model_id}", h.delete)
		},
	}
}

type adminAIModelsHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func (h *adminAIModelsHandler) list(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	rows, err := h.pool.Query(r.Context(),
		`SELECT `+adminLLMModelCols+` FROM llm_models ORDER BY sort_order ASC, model_id ASC`)
	if err != nil {
		h.fail(w, r, err, "list")
		return
	}
	defer rows.Close()
	out := make([]adminLLMModelDTO, 0, 16)
	for rows.Next() {
		row, err := scanAdminLLMModel(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
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

func (h *adminAIModelsHandler) create(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	var body adminLLMModelUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if body.ModelID == "" || body.Label == "" || body.Provider == "" {
		http.Error(w, `{"error":"model_id, label, provider required"}`, http.StatusBadRequest)
		return
	}
	if body.Tier != "free" && body.Tier != "premium" {
		body.Tier = "free"
	}
	enabled := true
	if body.IsEnabled != nil {
		enabled = *body.IsEnabled
	}
	useArena, useInsight, useMock := true, true, true
	if body.UseForArena != nil {
		useArena = *body.UseForArena
	}
	if body.UseForInsight != nil {
		useInsight = *body.UseForInsight
	}
	if body.UseForMock != nil {
		useMock = *body.UseForMock
	}
	sortOrder := 0
	if body.SortOrder != nil {
		sortOrder = *body.SortOrder
	}
	row := h.pool.QueryRow(r.Context(), `
		INSERT INTO llm_models (
			model_id, label, provider, tier, is_enabled,
			context_window, cost_per_1k_input_usd, cost_per_1k_output_usd,
			use_for_arena, use_for_insight, use_for_mock, sort_order
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING `+adminLLMModelCols,
		body.ModelID, body.Label, body.Provider, body.Tier, enabled,
		body.ContextWindow, body.CostPerKInputUSD, body.CostPerKOutputUSD,
		useArena, useInsight, useMock, sortOrder)
	out, err := scanAdminLLMModel(row)
	if err != nil {
		h.fail(w, r, err, "create")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(out)
}

func (h *adminAIModelsHandler) update(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
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
	row := h.pool.QueryRow(r.Context(), `
		UPDATE llm_models SET
		  label = COALESCE(NULLIF($2,''), label),
		  provider = COALESCE(NULLIF($3,''), provider),
		  tier = COALESCE(NULLIF($4,''), tier),
		  is_enabled = COALESCE($5, is_enabled),
		  context_window = COALESCE($6, context_window),
		  cost_per_1k_input_usd = COALESCE($7, cost_per_1k_input_usd),
		  cost_per_1k_output_usd = COALESCE($8, cost_per_1k_output_usd),
		  use_for_arena = COALESCE($9, use_for_arena),
		  use_for_insight = COALESCE($10, use_for_insight),
		  use_for_mock = COALESCE($11, use_for_mock),
		  sort_order = COALESCE($12, sort_order),
		  updated_at = now()
		WHERE model_id = $1
		RETURNING `+adminLLMModelCols,
		modelID, body.Label, body.Provider, body.Tier, body.IsEnabled,
		body.ContextWindow, body.CostPerKInputUSD, body.CostPerKOutputUSD,
		body.UseForArena, body.UseForInsight, body.UseForMock, body.SortOrder)
	out, err := scanAdminLLMModel(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "update")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *adminAIModelsHandler) toggle(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	modelID := chi.URLParam(r, "model_id")
	row := h.pool.QueryRow(r.Context(), `
		UPDATE llm_models SET is_enabled = NOT is_enabled, updated_at = now()
		WHERE model_id = $1
		RETURNING `+adminLLMModelCols, modelID)
	out, err := scanAdminLLMModel(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "toggle")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func (h *adminAIModelsHandler) delete(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	modelID := chi.URLParam(r, "model_id")
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM llm_models WHERE model_id = $1`, modelID)
	if err != nil {
		h.fail(w, r, err, "delete")
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func scanAdminLLMModel(row pgx.Row) (adminLLMModelDTO, error) {
	var d adminLLMModelDTO
	err := row.Scan(
		&d.ID, &d.ModelID, &d.Label, &d.Provider, &d.Tier, &d.IsEnabled,
		&d.ContextWindow, &d.CostPerKInputUSD, &d.CostPerKOutputUSD,
		&d.UseForArena, &d.UseForInsight, &d.UseForMock, &d.SortOrder,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return d, fmt.Errorf("scan llm_model: %w", err)
	}
	return d, nil
}

func (h *adminAIModelsHandler) fail(w http.ResponseWriter, r *http.Request, err error, op string) {
	if h.log != nil {
		h.log.ErrorContext(r.Context(), "admin.ai_models: "+op+" failed", slog.Any("err", err))
	}
	http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
}

// _ keeps sharedpg referenced for future scoped queries.
var _ = sharedpg.UUID
