// pipeline_handler.go — R7 Phase 1 chi-direct endpoints for the
// admin Company Manager redesign:
//
//	GET  /admin/mock/companies/{id}/validate          → ValidationReport
//	GET  /admin/mock/stage-templates                  → []StageTemplate
//	POST /admin/mock/companies/{id}/apply-template    → ApplyResult
//
// Mirrors rooms_handler.go / observability_handler.go pattern — role
// gate runs inline through requireAdmin, JSON response через writeJSON.
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/admin/app"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// PipelineHandler aggregates the UCs that power the redesigned admin
// company manager. Wired in cmd/monolith/services/admin/admin.go.
type PipelineHandler struct {
	Validate      *app.ValidatePipeline
	ListTemplates *app.ListStageTemplates
	ApplyTemplate *app.ApplyStageTemplate
	Log           *slog.Logger
}

// NewPipelineHandler — все три UC обязательны.
func NewPipelineHandler(
	validate *app.ValidatePipeline,
	listTemplates *app.ListStageTemplates,
	applyTemplate *app.ApplyStageTemplate,
	log *slog.Logger,
) *PipelineHandler {
	return &PipelineHandler{
		Validate:      validate,
		ListTemplates: listTemplates,
		ApplyTemplate: applyTemplate,
		Log:           log,
	}
}

// HandleValidate — GET /admin/mock/companies/{id}/validate.
func (h *PipelineHandler) HandleValidate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	idStr := chi.URLParam(r, "id")
	companyID, err := uuid.Parse(idStr)
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid company id")
		return
	}
	report, err := h.Validate.Do(r.Context(), companyID)
	if err != nil {
		h.Log.ErrorContext(r.Context(), "admin.pipeline.validate", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, report)
}

// HandleListTemplates — GET /admin/mock/stage-templates.
func (h *PipelineHandler) HandleListTemplates(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	items, err := h.ListTemplates.Do(r.Context())
	if err != nil {
		h.Log.ErrorContext(r.Context(), "admin.pipeline.listTemplates", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, map[string]any{"items": items})
}

// applyBody — POST body for apply-template.
type applyBody struct {
	TemplateSlug string `json:"template_slug"`
}

// HandleApplyTemplate — POST /admin/mock/companies/{id}/apply-template.
func (h *PipelineHandler) HandleApplyTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	idStr := chi.URLParam(r, "id")
	companyID, err := uuid.Parse(idStr)
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid company id")
		return
	}
	var body applyBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.TemplateSlug == "" {
		writeJSONErr(w, http.StatusBadRequest, "template_slug required")
		return
	}
	res, err := h.ApplyTemplate.Do(r.Context(), companyID, body.TemplateSlug)
	if errors.Is(err, app.ErrTemplateNotFound) {
		writeJSONErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		// usage_count bump failure leaks here — but res is still set
		// with the applied stages. Log and 500 since UI should refetch.
		h.Log.ErrorContext(r.Context(), "admin.pipeline.applyTemplate", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, res)
}

// requireAdmin mirrors ObservabilityHandler.requireAdmin — Go forbids
// shared methods across types in different files без переноса в shared
// helper, и эта функция тривиальна.
func (h *PipelineHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
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
