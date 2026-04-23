// admin_models.go — chi-direct admin REST surface for the llm_models
// registry (migration 00033). Mounted under /api/v1/admin/ai/models.
//
// Why chi-direct instead of Connect-RPC: the surface is tiny CRUD on a
// single table (5 routes), the proto definition would just mirror this
// one-to-one, and we'd pay a regen-on-every-change tax. Mirrors the
// pattern in podcast/ports/cms_handler.go.
//
// Auth: bearer enforced at router.go (restAuthGate). Admin role is
// enforced inside each handler via UserRoleFromContext, identical to
// AdminServer.requireAdmin and the podcast CMS.
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"druz9/ai_native/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
)

// AdminModelsHandler exposes CRUD over llm_models for the operator
// console. Same Repo as the public ModelsHandler — admin sees disabled
// rows, public callers see only is_enabled=true.
type AdminModelsHandler struct {
	Repo domain.LLMModelRepo
	Log  *slog.Logger
}

// NewAdminModelsHandler wires the handler. Both Repo and Log are
// required (anti-fallback policy: nil logger → panic).
func NewAdminModelsHandler(repo domain.LLMModelRepo, log *slog.Logger) *AdminModelsHandler {
	if repo == nil {
		panic("ai_native.ports.NewAdminModelsHandler: repo is required")
	}
	if log == nil {
		panic("ai_native.ports.NewAdminModelsHandler: logger is required")
	}
	return &AdminModelsHandler{Repo: repo, Log: log}
}

// Mount registers the five admin routes on the given chi router. Caller
// adds the /api/v1 prefix.
func (h *AdminModelsHandler) Mount(r chi.Router) {
	r.Get("/admin/ai/models", h.list)
	r.Post("/admin/ai/models", h.create)
	r.Patch("/admin/ai/models/{model_id}", h.update)
	r.Patch("/admin/ai/models/{model_id}/toggle", h.toggle)
	r.Delete("/admin/ai/models/{model_id}", h.delete)
}

// adminModelDTO is the JSON wire shape — matches frontend types in
// lib/queries/ai.ts AdminLLMModel.
type adminModelDTO struct {
	ID                 int64    `json:"id"`
	ModelID            string   `json:"model_id"`
	Label              string   `json:"label"`
	Provider           string   `json:"provider"`
	Tier               string   `json:"tier"`
	IsEnabled          bool     `json:"is_enabled"`
	ContextWindow      *int     `json:"context_window,omitempty"`
	CostPer1KInputUSD  *float64 `json:"cost_per_1k_input_usd,omitempty"`
	CostPer1KOutputUSD *float64 `json:"cost_per_1k_output_usd,omitempty"`
	UseForArena        bool     `json:"use_for_arena"`
	UseForInsight      bool     `json:"use_for_insight"`
	UseForMock         bool     `json:"use_for_mock"`
	SortOrder          int      `json:"sort_order"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
}

func toAdminDTO(m domain.LLMModel) adminModelDTO {
	return adminModelDTO{
		ID:                 m.ID,
		ModelID:            m.ModelID,
		Label:              m.Label,
		Provider:           m.Provider,
		Tier:               string(m.Tier),
		IsEnabled:          m.IsEnabled,
		ContextWindow:      m.ContextWindow,
		CostPer1KInputUSD:  m.CostPer1KInputUSD,
		CostPer1KOutputUSD: m.CostPer1KOutputUSD,
		UseForArena:        m.UseForArena,
		UseForInsight:      m.UseForInsight,
		UseForMock:         m.UseForMock,
		SortOrder:          m.SortOrder,
		CreatedAt:          m.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		UpdatedAt:          m.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

// adminModelsListResponse wraps the list so the JSON shape can grow
// (pagination cursor, etc.) without breaking the client.
type adminModelsListResponse struct {
	Items []adminModelDTO `json:"items"`
}

// adminModelUpsertBody is the request body for POST + PATCH (full).
// All fields are optional on PATCH — zero/nil means "leave unchanged"
// for booleans we use *bool to disambiguate "set false" from "omit".
type adminModelUpsertBody struct {
	ModelID            *string  `json:"model_id,omitempty"`
	Label              *string  `json:"label,omitempty"`
	Provider           *string  `json:"provider,omitempty"`
	Tier               *string  `json:"tier,omitempty"`
	IsEnabled          *bool    `json:"is_enabled,omitempty"`
	ContextWindow      *int     `json:"context_window,omitempty"`
	CostPer1KInputUSD  *float64 `json:"cost_per_1k_input_usd,omitempty"`
	CostPer1KOutputUSD *float64 `json:"cost_per_1k_output_usd,omitempty"`
	UseForArena        *bool    `json:"use_for_arena,omitempty"`
	UseForInsight      *bool    `json:"use_for_insight,omitempty"`
	UseForMock         *bool    `json:"use_for_mock,omitempty"`
	SortOrder          *int     `json:"sort_order,omitempty"`
}

// list returns every row, including is_enabled=false ones — admin needs
// to see disabled models to flip them back on.
func (h *AdminModelsHandler) list(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	rows, err := h.Repo.List(r.Context(), domain.LLMModelFilter{})
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	out := adminModelsListResponse{Items: make([]adminModelDTO, 0, len(rows))}
	for _, m := range rows {
		out.Items = append(out.Items, toAdminDTO(m))
	}
	writeJSONOK(w, http.StatusOK, out)
}

// create inserts a new row. model_id MUST be unique; conflict → 409.
func (h *AdminModelsHandler) create(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var body adminModelUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	m := domain.LLMModel{
		// Defaults match the migration's column defaults so an admin
		// who only fills the four required fields gets a sensible row.
		Tier:          domain.LLMModelTierFree,
		IsEnabled:     true,
		UseForArena:   true,
		UseForInsight: true,
		UseForMock:    true,
	}
	applyUpsert(&m, body)
	out, err := h.Repo.Create(r.Context(), m)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	writeJSONOK(w, http.StatusCreated, toAdminDTO(out))
}

// update is full-replace via PATCH (we GET-then-merge to keep the route
// idempotent for partial bodies — matches the podcast CMS pattern).
func (h *AdminModelsHandler) update(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	modelID := strings.TrimSpace(chi.URLParam(r, "model_id"))
	if modelID == "" {
		writeJSONErr(w, http.StatusBadRequest, "model_id required")
		return
	}
	var body adminModelUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	current, err := h.Repo.GetByID(r.Context(), modelID)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	applyUpsert(&current, body)
	out, err := h.Repo.Update(r.Context(), modelID, current)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	writeJSONOK(w, http.StatusOK, toAdminDTO(out))
}

// toggle is a cheap inline flip for the admin grid.
func (h *AdminModelsHandler) toggle(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	modelID := strings.TrimSpace(chi.URLParam(r, "model_id"))
	if modelID == "" {
		writeJSONErr(w, http.StatusBadRequest, "model_id required")
		return
	}
	current, err := h.Repo.GetByID(r.Context(), modelID)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	if err := h.Repo.SetEnabled(r.Context(), modelID, !current.IsEnabled); err != nil {
		h.respondErr(w, r, err)
		return
	}
	current.IsEnabled = !current.IsEnabled
	writeJSONOK(w, http.StatusOK, toAdminDTO(current))
}

// delete hard-removes a row. The admin UI also exposes the soft-delete
// path (toggle is_enabled=false) — this endpoint is for "this OpenRouter
// id was never going to be supported, get it out of my dropdown".
func (h *AdminModelsHandler) delete(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	modelID := strings.TrimSpace(chi.URLParam(r, "model_id"))
	if modelID == "" {
		writeJSONErr(w, http.StatusBadRequest, "model_id required")
		return
	}
	if err := h.Repo.Delete(r.Context(), modelID); err != nil {
		h.respondErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// applyUpsert merges the request body into the model. Only set fields
// (non-nil pointers) are touched — unset fields keep their previous
// value. Single helper used by both create and update.
func applyUpsert(m *domain.LLMModel, b adminModelUpsertBody) {
	if b.ModelID != nil {
		m.ModelID = strings.TrimSpace(*b.ModelID)
	}
	if b.Label != nil {
		m.Label = strings.TrimSpace(*b.Label)
	}
	if b.Provider != nil {
		m.Provider = strings.TrimSpace(*b.Provider)
	}
	if b.Tier != nil {
		m.Tier = domain.LLMModelTier(strings.TrimSpace(*b.Tier))
	}
	if b.IsEnabled != nil {
		m.IsEnabled = *b.IsEnabled
	}
	if b.ContextWindow != nil {
		m.ContextWindow = b.ContextWindow
	}
	if b.CostPer1KInputUSD != nil {
		m.CostPer1KInputUSD = b.CostPer1KInputUSD
	}
	if b.CostPer1KOutputUSD != nil {
		m.CostPer1KOutputUSD = b.CostPer1KOutputUSD
	}
	if b.UseForArena != nil {
		m.UseForArena = *b.UseForArena
	}
	if b.UseForInsight != nil {
		m.UseForInsight = *b.UseForInsight
	}
	if b.UseForMock != nil {
		m.UseForMock = *b.UseForMock
	}
	if b.SortOrder != nil {
		m.SortOrder = *b.SortOrder
	}
}

// requireAdmin enforces the role gate. Returns true on success; on
// failure the response has already been written.
func (h *AdminModelsHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if _, ok := sharedMw.UserIDFromContext(r.Context()); !ok {
		writeJSONErr(w, http.StatusUnauthorized, "unauthenticated")
		return false
	}
	role, ok := sharedMw.UserRoleFromContext(r.Context())
	if !ok || role != string(enums.UserRoleAdmin) {
		writeJSONErr(w, http.StatusForbidden, "admin role required")
		return false
	}
	return true
}

// respondErr maps domain errors to HTTP statuses.
func (h *AdminModelsHandler) respondErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrLLMModelNotFound):
		writeJSONErr(w, http.StatusNotFound, "model not found")
	case errors.Is(err, domain.ErrLLMModelConflict):
		writeJSONErr(w, http.StatusConflict, "model_id already exists")
	case errors.Is(err, domain.ErrLLMModelInvalid):
		writeJSONErr(w, http.StatusBadRequest, err.Error())
	default:
		h.Log.ErrorContext(r.Context(), "ai_native.admin_models: unexpected error", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "llm_models cms failure")
	}
}

func writeJSONOK(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONErr(w http.ResponseWriter, status int, msg string) {
	writeJSONOK(w, status, map[string]string{"error": msg})
}
