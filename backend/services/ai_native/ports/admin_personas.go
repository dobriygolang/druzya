// admin_personas.go — chi-direct admin REST surface for the personas
// registry (migration 00051). Mounted under /api/v1/admin/personas.
//
// Design mirrors admin_models.go 1:1 so the admin UI can reuse the
// same table + form patterns. Five routes: list, create, update,
// toggle, delete. Admin role enforced via requireAdminPersonas (same
// bearer + role gate pattern as other admin endpoints).
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

// AdminPersonasHandler exposes CRUD over personas for the operator
// console. Same Repo as PersonasHandler — admin sees disabled rows
// (is_enabled=false), public callers see only is_enabled=true.
type AdminPersonasHandler struct {
	Repo domain.PersonaRepo
	Log  *slog.Logger
}

// NewAdminPersonasHandler wires the handler. Both Repo and Log are
// required (anti-fallback policy: nil logger → panic).
func NewAdminPersonasHandler(repo domain.PersonaRepo, log *slog.Logger) *AdminPersonasHandler {
	if repo == nil {
		panic("ai_native.ports.NewAdminPersonasHandler: repo is required")
	}
	if log == nil {
		panic("ai_native.ports.NewAdminPersonasHandler: logger is required")
	}
	return &AdminPersonasHandler{Repo: repo, Log: log}
}

// Mount registers the five admin routes on the given chi router.
// Caller adds the /api/v1 prefix.
func (h *AdminPersonasHandler) Mount(r chi.Router) {
	r.Get("/admin/personas", h.list)
	r.Post("/admin/personas", h.create)
	r.Patch("/admin/personas/{id}", h.update)
	r.Patch("/admin/personas/{id}/toggle", h.toggle)
	r.Delete("/admin/personas/{id}", h.delete)
}

// adminPersonaDTO — JSON wire shape for the admin grid. Full set of
// fields (including created_at / updated_at for sorting + audit).
type adminPersonaDTO struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	Hint          string `json:"hint"`
	IconEmoji     string `json:"icon_emoji"`
	BrandGradient string `json:"brand_gradient"`
	SuggestedTask string `json:"suggested_task"`
	SystemPrompt  string `json:"system_prompt"`
	SortOrder     int    `json:"sort_order"`
	IsEnabled     bool   `json:"is_enabled"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

func toAdminPersonaDTO(p domain.Persona) adminPersonaDTO {
	return adminPersonaDTO{
		ID:            p.ID,
		Label:         p.Label,
		Hint:          p.Hint,
		IconEmoji:     p.IconEmoji,
		BrandGradient: p.BrandGradient,
		SuggestedTask: p.SuggestedTask,
		SystemPrompt:  p.SystemPrompt,
		SortOrder:     p.SortOrder,
		IsEnabled:     p.IsEnabled,
		CreatedAt:     p.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		UpdatedAt:     p.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

type adminPersonasListResponse struct {
	Items []adminPersonaDTO `json:"items"`
}

// adminPersonaUpsertBody is the request body for POST + PATCH. All
// fields optional on PATCH; *bool / *int to disambiguate "omit" from
// "set zero value". POST requires at least id + label (repo validates).
type adminPersonaUpsertBody struct {
	ID            *string `json:"id,omitempty"`
	Label         *string `json:"label,omitempty"`
	Hint          *string `json:"hint,omitempty"`
	IconEmoji     *string `json:"icon_emoji,omitempty"`
	BrandGradient *string `json:"brand_gradient,omitempty"`
	SuggestedTask *string `json:"suggested_task,omitempty"`
	SystemPrompt  *string `json:"system_prompt,omitempty"`
	SortOrder     *int    `json:"sort_order,omitempty"`
	IsEnabled     *bool   `json:"is_enabled,omitempty"`
}

func (h *AdminPersonasHandler) list(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	rows, err := h.Repo.List(r.Context(), domain.PersonaFilter{})
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	out := adminPersonasListResponse{Items: make([]adminPersonaDTO, 0, len(rows))}
	for _, p := range rows {
		out.Items = append(out.Items, toAdminPersonaDTO(p))
	}
	writeJSONOK(w, http.StatusOK, out)
}

func (h *AdminPersonasHandler) create(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var body adminPersonaUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	p := domain.Persona{
		// Sensible defaults matching the migration column defaults.
		IconEmoji: "💬",
		SortOrder: 100,
		IsEnabled: true,
	}
	applyPersonaUpsert(&p, body)
	out, err := h.Repo.Create(r.Context(), p)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	writeJSONOK(w, http.StatusCreated, toAdminPersonaDTO(out))
}

func (h *AdminPersonasHandler) update(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		writeJSONErr(w, http.StatusBadRequest, "id required")
		return
	}
	var body adminPersonaUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	current, err := h.Repo.GetByID(r.Context(), id)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	applyPersonaUpsert(&current, body)
	out, err := h.Repo.Update(r.Context(), id, current)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	writeJSONOK(w, http.StatusOK, toAdminPersonaDTO(out))
}

func (h *AdminPersonasHandler) toggle(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		writeJSONErr(w, http.StatusBadRequest, "id required")
		return
	}
	current, err := h.Repo.GetByID(r.Context(), id)
	if err != nil {
		h.respondErr(w, r, err)
		return
	}
	if err := h.Repo.SetEnabled(r.Context(), id, !current.IsEnabled); err != nil {
		h.respondErr(w, r, err)
		return
	}
	current.IsEnabled = !current.IsEnabled
	writeJSONOK(w, http.StatusOK, toAdminPersonaDTO(current))
}

func (h *AdminPersonasHandler) delete(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		writeJSONErr(w, http.StatusBadRequest, "id required")
		return
	}
	if err := h.Repo.Delete(r.Context(), id); err != nil {
		h.respondErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// applyPersonaUpsert merges the upsert body into the domain struct.
// Only set fields (non-nil pointers) are applied; unset keep current
// values. Used by both create and update.
func applyPersonaUpsert(p *domain.Persona, b adminPersonaUpsertBody) {
	if b.ID != nil {
		p.ID = strings.TrimSpace(*b.ID)
	}
	if b.Label != nil {
		p.Label = strings.TrimSpace(*b.Label)
	}
	if b.Hint != nil {
		p.Hint = *b.Hint
	}
	if b.IconEmoji != nil {
		p.IconEmoji = *b.IconEmoji
	}
	if b.BrandGradient != nil {
		p.BrandGradient = *b.BrandGradient
	}
	if b.SuggestedTask != nil {
		p.SuggestedTask = strings.TrimSpace(*b.SuggestedTask)
	}
	if b.SystemPrompt != nil {
		p.SystemPrompt = *b.SystemPrompt
	}
	if b.SortOrder != nil {
		p.SortOrder = *b.SortOrder
	}
	if b.IsEnabled != nil {
		p.IsEnabled = *b.IsEnabled
	}
}

func (h *AdminPersonasHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
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

func (h *AdminPersonasHandler) respondErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrPersonaNotFound):
		writeJSONErr(w, http.StatusNotFound, "persona not found")
	case errors.Is(err, domain.ErrPersonaConflict):
		writeJSONErr(w, http.StatusConflict, "id already exists")
	case errors.Is(err, domain.ErrPersonaInvalid):
		writeJSONErr(w, http.StatusBadRequest, err.Error())
	default:
		h.Log.ErrorContext(r.Context(), "ai_native.admin_personas: unexpected error", slog.Any("err", err))
		writeJSONErr(w, http.StatusInternalServerError, "personas cms failure")
	}
}
