// admin_personas.go — chi-direct admin CRUD over `personas`.
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

func dtoFromPersona(p adminDomain.Persona) adminPersonaDTO {
	return adminPersonaDTO{
		ID: p.ID, Label: p.Label, Hint: p.Hint, IconEmoji: p.IconEmoji,
		BrandGradient: p.BrandGradient, SuggestedTask: p.SuggestedTask,
		SystemPrompt: p.SystemPrompt, SortOrder: p.SortOrder, IsEnabled: p.IsEnabled,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

// NewPersonas wires the admin write surface for personas.
func NewPersonas(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewPersonas(d.Pool)
	h := &adminPersonasHandler{
		list:   &adminApp.ListPersonas{Personas: repo},
		create: &adminApp.CreatePersona{Personas: repo},
		update: &adminApp.UpdatePersona{Personas: repo},
		toggle: &adminApp.TogglePersona{Personas: repo},
		delete: &adminApp.DeletePersona{Personas: repo},
		log:    d.Log,
	}
	return &monolithServices.Module{
		MountPublicREST: func(r chi.Router) {
			// Public read — copilot UI consumes it before admin features
			// are reachable.
			r.Get("/personas", h.handleListPublic)
		},
		MountREST: func(r chi.Router) {
			r.Get("/admin/personas", h.handleList)
			r.Post("/admin/personas", h.handleCreate)
			r.Patch("/admin/personas/{id}", h.handleUpdate)
			r.Patch("/admin/personas/{id}/toggle", h.handleToggle)
			r.Delete("/admin/personas/{id}", h.handleDelete)
		},
	}
}

type adminPersonasHandler struct {
	list   *adminApp.ListPersonas
	create *adminApp.CreatePersona
	update *adminApp.UpdatePersona
	toggle *adminApp.TogglePersona
	delete *adminApp.DeletePersona
	log    *slog.Logger
}

func (h *adminPersonasHandler) handleListPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.list.Do(r.Context(), true)
	if err != nil {
		h.fail(w, r, err, "list_public")
		return
	}
	out := make([]adminPersonaDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, dtoFromPersona(row))
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *adminPersonasHandler) handleList(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	rows, err := h.list.Do(r.Context(), false)
	if err != nil {
		h.fail(w, r, err, "list")
		return
	}
	out := make([]adminPersonaDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, dtoFromPersona(row))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

type adminPersonaUpsertBody struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	Hint          string `json:"hint"`
	IconEmoji     string `json:"icon_emoji"`
	BrandGradient string `json:"brand_gradient"`
	SuggestedTask string `json:"suggested_task"`
	SystemPrompt  string `json:"system_prompt"`
	SortOrder     *int   `json:"sort_order,omitempty"`
	IsEnabled     *bool  `json:"is_enabled,omitempty"`
}

func (b adminPersonaUpsertBody) toUpsert() adminDomain.PersonaUpsert {
	return adminDomain.PersonaUpsert{
		ID: b.ID, Label: b.Label, Hint: b.Hint, IconEmoji: b.IconEmoji,
		BrandGradient: b.BrandGradient, SuggestedTask: b.SuggestedTask,
		SystemPrompt: b.SystemPrompt, SortOrder: b.SortOrder, IsEnabled: b.IsEnabled,
	}
}

func (h *adminPersonasHandler) handleCreate(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	var body adminPersonaUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	out, err := h.create.Do(r.Context(), body.toUpsert())
	if err != nil {
		if errors.Is(err, adminDomain.ErrInvalidInput) {
			http.Error(w, `{"error":"id and label required"}`, http.StatusBadRequest)
			return
		}
		h.fail(w, r, err, "create")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(dtoFromPersona(out))
}

func (h *adminPersonasHandler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, `{"error":"id required"}`, http.StatusBadRequest)
		return
	}
	var body adminPersonaUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	out, err := h.update.Do(r.Context(), id, body.toUpsert())
	if err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		if errors.Is(err, adminDomain.ErrInvalidInput) {
			http.Error(w, `{"error":"id required"}`, http.StatusBadRequest)
			return
		}
		h.fail(w, r, err, "update")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dtoFromPersona(out))
}

func (h *adminPersonasHandler) handleToggle(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id := chi.URLParam(r, "id")
	out, err := h.toggle.Do(r.Context(), id)
	if err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "toggle")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dtoFromPersona(out))
}

func (h *adminPersonasHandler) handleDelete(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.delete.Do(r.Context(), id); err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "delete")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *adminPersonasHandler) fail(w http.ResponseWriter, r *http.Request, err error, op string) {
	if h.log != nil {
		h.log.ErrorContext(r.Context(), "admin.personas: "+op+" failed", slog.Any("err", err))
	}
	http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
}
