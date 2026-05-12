// coach_prompts_handler.go — Admin Phase 2: coach prompt CRUD endpoints.
//
//	GET    /admin/coach-prompts              → list (admin sees all)
//	POST   /admin/coach-prompts              → create
//	PATCH  /admin/coach-prompts/{id}         → partial update (bumps version)
//	POST   /admin/coach-prompts/{id}/deactivate → soft delete
//
// Mirrors goal_presets_handler — chi-direct, role gate inline via
// requireAdmin{,WithID}.
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

// CoachPromptsHandler aggregates UCs.
type CoachPromptsHandler struct {
	List       *app.ListCoachPrompts
	Create     *app.CreateCoachPrompt
	Update     *app.UpdateCoachPrompt
	Deactivate *app.DeactivateCoachPrompt
	Log        *slog.Logger
}

// NewCoachPromptsHandler wires UCs.
func NewCoachPromptsHandler(
	list *app.ListCoachPrompts,
	create *app.CreateCoachPrompt,
	update *app.UpdateCoachPrompt,
	deactivate *app.DeactivateCoachPrompt,
	log *slog.Logger,
) *CoachPromptsHandler {
	return &CoachPromptsHandler{
		List:       list,
		Create:     create,
		Update:     update,
		Deactivate: deactivate,
		Log:        log,
	}
}

type coachPromptDTO struct {
	ID          string   `json:"id"`
	Slug        string   `json:"slug"`
	Category    string   `json:"category"`
	Template    string   `json:"template"`
	Variables   []string `json:"variables"`
	Description string   `json:"description"`
	IsActive    bool     `json:"is_active"`
	Version     int      `json:"version"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

func coachPromptToDTO(p domain.CoachPrompt) coachPromptDTO {
	vars := p.Variables
	if vars == nil {
		vars = []string{}
	}
	return coachPromptDTO{
		ID:          p.ID.String(),
		Slug:        p.Slug,
		Category:    p.Category,
		Template:    p.Template,
		Variables:   vars,
		Description: p.Description,
		IsActive:    p.IsActive,
		Version:     p.Version,
		CreatedAt:   p.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   p.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

type createCoachPromptBody struct {
	Slug        string   `json:"slug"`
	Category    string   `json:"category"`
	Template    string   `json:"template"`
	Variables   []string `json:"variables"`
	Description string   `json:"description"`
	IsActive    *bool    `json:"is_active"`
}

type updateCoachPromptBody struct {
	Category    *string   `json:"category"`
	Template    *string   `json:"template"`
	Variables   *[]string `json:"variables"`
	Description *string   `json:"description"`
	IsActive    *bool     `json:"is_active"`
}

// HandleList — GET /admin/coach-prompts. Admin sees all; ?active=true filters.
func (h *CoachPromptsHandler) HandleList(w http.ResponseWriter, r *http.Request) {
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
	out := make([]coachPromptDTO, 0, len(items))
	for _, p := range items {
		out = append(out, coachPromptToDTO(p))
	}
	writeJSON(w, map[string]any{"items": out})
}

// HandleCreate — POST /admin/coach-prompts.
func (h *CoachPromptsHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.requireAdminWithID(w, r)
	if !ok {
		return
	}
	var body createCoachPromptBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	isActive := true
	if body.IsActive != nil {
		isActive = *body.IsActive
	}
	vars := body.Variables
	if vars == nil {
		vars = []string{}
	}
	in := domain.CoachPromptUpsert{
		Slug:        strings.TrimSpace(body.Slug),
		Category:    body.Category,
		Template:    body.Template,
		Variables:   vars,
		Description: body.Description,
		IsActive:    isActive,
		CreatedBy:   &uid,
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
	writeJSON(w, coachPromptToDTO(out))
}

// HandleUpdate — PATCH /admin/coach-prompts/{id}.
func (h *CoachPromptsHandler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body updateCoachPromptBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	patch := domain.CoachPromptPatch{
		Category:    body.Category,
		Template:    body.Template,
		Variables:   body.Variables,
		Description: body.Description,
		IsActive:    body.IsActive,
	}
	out, err := h.Update.Do(r.Context(), id, patch)
	if errors.Is(err, domain.ErrInvalidInput) {
		writeJSONErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeJSONErr(w, http.StatusNotFound, "prompt not found")
		return
	}
	if err != nil {
		h.logErr(r, "update", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, coachPromptToDTO(out))
}

// HandleDeactivate — POST /admin/coach-prompts/{id}/deactivate.
func (h *CoachPromptsHandler) HandleDeactivate(w http.ResponseWriter, r *http.Request) {
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
			writeJSONErr(w, http.StatusNotFound, "prompt not found")
			return
		}
		h.logErr(r, "deactivate", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// ── role gate (mirrors GoalPresetsHandler) ─────────────────────────────

func (h *CoachPromptsHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	_, ok := h.requireAdminWithID(w, r)
	return ok
}

func (h *CoachPromptsHandler) requireAdminWithID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
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

func (h *CoachPromptsHandler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "admin.coach_prompts."+op, slog.Any("err", err))
}
