// goal_presets_handler.go — Admin Phase 2: goal preset CRUD chi-direct endpoints.
//
//	GET    /admin/goal-presets             → list (admin-only; includes inactive)
//	POST   /admin/goal-presets             → create
//	PATCH  /admin/goal-presets/{id}        → partial update
//	POST   /admin/goal-presets/{id}/deactivate → soft delete
//
//	GET    /goal-presets                   → PUBLIC; active only, no auth role-gate
//	                                          (used by GoalWizard quick-start pills)
//
// Mirrors pipeline_handler / observability_handler patterns — chi-direct,
// role-gate inline via requireAdmin (admin routes) или omitted (public route).
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"druz9/admin/app"
	"druz9/admin/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// GoalPresetsHandler aggregates UCs for the goal_presets surface.
type GoalPresetsHandler struct {
	List       *app.ListGoalPresets
	Create     *app.CreateGoalPreset
	Update     *app.UpdateGoalPreset
	Deactivate *app.DeactivateGoalPreset
	Log        *slog.Logger
}

// NewGoalPresetsHandler — every UC required (admin route surface).
func NewGoalPresetsHandler(
	list *app.ListGoalPresets,
	create *app.CreateGoalPreset,
	update *app.UpdateGoalPreset,
	deactivate *app.DeactivateGoalPreset,
	log *slog.Logger,
) *GoalPresetsHandler {
	return &GoalPresetsHandler{
		List:       list,
		Create:     create,
		Update:     update,
		Deactivate: deactivate,
		Log:        log,
	}
}

// ─────────────────────────────────────────────────────────────────────────
// DTOs — flat JSON shape the admin/frontend hooks consume.
// ─────────────────────────────────────────────────────────────────────────

type goalPresetDTO struct {
	ID                string `json:"id"`
	Slug              string `json:"slug"`
	Title             string `json:"title"`
	Kind              string `json:"kind"`
	TargetCompany     string `json:"target_company"`
	TargetLevel       string `json:"target_level"`
	TargetText        string `json:"target_text"`
	DefaultTargetDays *int   `json:"default_target_days,omitempty"`
	IsActive          bool   `json:"is_active"`
	SortOrder         int    `json:"sort_order"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

func goalPresetToDTO(p domain.GoalPreset) goalPresetDTO {
	dto := goalPresetDTO{
		ID:                p.ID.String(),
		Slug:              p.Slug,
		Title:             p.Title,
		Kind:              p.Kind,
		TargetCompany:     p.TargetCompany,
		TargetLevel:       p.TargetLevel,
		TargetText:        p.TargetText,
		DefaultTargetDays: p.DefaultTargetDays,
		IsActive:          p.IsActive,
		SortOrder:         p.SortOrder,
		CreatedAt:         p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:         p.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	return dto
}

type createGoalPresetBody struct {
	Slug              string `json:"slug"`
	Title             string `json:"title"`
	Kind              string `json:"kind"`
	TargetCompany     string `json:"target_company"`
	TargetLevel       string `json:"target_level"`
	TargetText        string `json:"target_text"`
	DefaultTargetDays *int   `json:"default_target_days"`
	IsActive          *bool  `json:"is_active"`
	SortOrder         int    `json:"sort_order"`
}

// updateGoalPresetBody — partial. All-pointer чтобы клиент мог послать
// только меняемые поля.
type updateGoalPresetBody struct {
	Title             *string `json:"title"`
	Kind              *string `json:"kind"`
	TargetCompany     *string `json:"target_company"`
	TargetLevel       *string `json:"target_level"`
	TargetText        *string `json:"target_text"`
	DefaultTargetDays *int    `json:"default_target_days"` // -1 = clear NULL
	IsActive          *bool   `json:"is_active"`
	SortOrder         *int    `json:"sort_order"`
}

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

// HandleListAdmin — GET /admin/goal-presets. Admin sees all (active+inactive).
// Query param ?active=true narrows down (mirrors public route).
func (h *GoalPresetsHandler) HandleListAdmin(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	activeOnly := r.URL.Query().Get("active") == "true"
	items, err := h.List.Do(r.Context(), activeOnly)
	if err != nil {
		h.logErr(r, "list", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]goalPresetDTO, 0, len(items))
	for _, p := range items {
		out = append(out, goalPresetToDTO(p))
	}
	writeJSON(w, map[string]any{"items": out})
}

// HandleListPublic — GET /goal-presets. NO admin gate; auth required only
// for the user-id (Wizard load). Reads active-only — admin presets list
// без is_active filter не светится.
//
// Anti-fallback: if backend down → handler errors, but frontend silent-skips
// the section. Здесь возвращаем нормальный 500 для ошибки чтобы клиент мог
// log'ировать.
func (h *GoalPresetsHandler) HandleListPublic(w http.ResponseWriter, r *http.Request) {
	items, err := h.List.Do(r.Context(), true)
	if err != nil {
		h.logErr(r, "list_public", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]goalPresetDTO, 0, len(items))
	for _, p := range items {
		out = append(out, goalPresetToDTO(p))
	}
	writeJSON(w, map[string]any{"items": out})
}

// HandleCreate — POST /admin/goal-presets.
func (h *GoalPresetsHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.requireAdminWithID(w, r)
	if !ok {
		return
	}
	var body createGoalPresetBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	isActive := true
	if body.IsActive != nil {
		isActive = *body.IsActive
	}
	in := domain.GoalPresetUpsert{
		Slug:              strings.TrimSpace(body.Slug),
		Title:             strings.TrimSpace(body.Title),
		Kind:              body.Kind,
		TargetCompany:     body.TargetCompany,
		TargetLevel:       body.TargetLevel,
		TargetText:        body.TargetText,
		DefaultTargetDays: body.DefaultTargetDays,
		IsActive:          isActive,
		SortOrder:         body.SortOrder,
		CreatedBy:         &uid,
	}
	out, err := h.Create.Do(r.Context(), in)
	if errors.Is(err, domain.ErrInvalidInput) {
		writeJSONErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, domain.ErrConflict) {
		writeJSONErr(w, http.StatusConflict, "slug already taken")
		return
	}
	if err != nil {
		h.logErr(r, "create", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, goalPresetToDTO(out))
}

// HandleUpdate — PATCH /admin/goal-presets/{id}.
func (h *GoalPresetsHandler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body updateGoalPresetBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	patch := domain.GoalPresetPatch{
		Title:             body.Title,
		Kind:              body.Kind,
		TargetCompany:     body.TargetCompany,
		TargetLevel:       body.TargetLevel,
		TargetText:        body.TargetText,
		DefaultTargetDays: body.DefaultTargetDays,
		IsActive:          body.IsActive,
		SortOrder:         body.SortOrder,
	}
	out, err := h.Update.Do(r.Context(), id, patch)
	if errors.Is(err, domain.ErrInvalidInput) {
		writeJSONErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeJSONErr(w, http.StatusNotFound, "preset not found")
		return
	}
	if err != nil {
		h.logErr(r, "update", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, goalPresetToDTO(out))
}

// HandleDeactivate — POST /admin/goal-presets/{id}/deactivate.
func (h *GoalPresetsHandler) HandleDeactivate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Deactivate.Do(r.Context(), id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeJSONErr(w, http.StatusNotFound, "preset not found")
			return
		}
		h.logErr(r, "deactivate", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// ─────────────────────────────────────────────────────────────────────────
// Role gate — mirrors pipeline_handler.requireAdmin (same UserRoleAdmin guard).
// ─────────────────────────────────────────────────────────────────────────

func (h *GoalPresetsHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	_, ok := h.requireAdminWithID(w, r)
	return ok
}

func (h *GoalPresetsHandler) requireAdminWithID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONErr(w, http.StatusUnauthorized, "unauthenticated")
		return uuid.Nil, false
	}
	role, rok := sharedMw.UserRoleFromContext(r.Context())
	if !rok || role != string(enums.UserRoleAdmin) {
		writeJSONErr(w, http.StatusForbidden, "admin role required")
		return uuid.Nil, false
	}
	return uid, true
}

func (h *GoalPresetsHandler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "admin.goal_presets."+op, slog.Any("err", err))
}
