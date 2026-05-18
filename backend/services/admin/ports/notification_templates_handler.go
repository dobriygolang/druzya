// notification_templates_handler.go — notification template CRUD endpoints.
//
//	GET    /admin/notification-templates                → list (?channel + ?active)
//	POST   /admin/notification-templates                → create
//	PATCH  /admin/notification-templates/{id}           → partial update
//	POST   /admin/notification-templates/{id}/deactivate→ soft delete
//
// Mirrors coach_prompts_handler — chi-direct + inline admin gate.
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

// NotificationTemplatesHandler aggregates UCs.
type NotificationTemplatesHandler struct {
	List       *app.ListNotificationTemplates
	Create     *app.CreateNotificationTemplate
	Update     *app.UpdateNotificationTemplate
	Deactivate *app.DeactivateNotificationTemplate
	Log        *slog.Logger
}

// NewNotificationTemplatesHandler wires UCs.
func NewNotificationTemplatesHandler(
	list *app.ListNotificationTemplates,
	create *app.CreateNotificationTemplate,
	update *app.UpdateNotificationTemplate,
	deactivate *app.DeactivateNotificationTemplate,
	log *slog.Logger,
) *NotificationTemplatesHandler {
	return &NotificationTemplatesHandler{
		List:       list,
		Create:     create,
		Update:     update,
		Deactivate: deactivate,
		Log:        log,
	}
}

type notificationTemplateDTO struct {
	ID              string   `json:"id"`
	Slug            string   `json:"slug"`
	Channel         string   `json:"channel"`
	SubjectTemplate string   `json:"subject_template"`
	BodyTemplate    string   `json:"body_template"`
	Variables       []string `json:"variables"`
	Description     string   `json:"description"`
	IsActive        bool     `json:"is_active"`
	CreatedAt       string   `json:"created_at"`
	UpdatedAt       string   `json:"updated_at"`
}

func notificationTemplateToDTO(t domain.NotificationTemplate) notificationTemplateDTO {
	vars := t.Variables
	if vars == nil {
		vars = []string{}
	}
	return notificationTemplateDTO{
		ID:              t.ID.String(),
		Slug:            t.Slug,
		Channel:         t.Channel,
		SubjectTemplate: t.SubjectTemplate,
		BodyTemplate:    t.BodyTemplate,
		Variables:       vars,
		Description:     t.Description,
		IsActive:        t.IsActive,
		CreatedAt:       t.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:       t.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

type createNotificationTemplateBody struct {
	Slug            string   `json:"slug"`
	Channel         string   `json:"channel"`
	SubjectTemplate string   `json:"subject_template"`
	BodyTemplate    string   `json:"body_template"`
	Variables       []string `json:"variables"`
	Description     string   `json:"description"`
	IsActive        *bool    `json:"is_active"`
}

type updateNotificationTemplateBody struct {
	Channel         *string   `json:"channel"`
	SubjectTemplate *string   `json:"subject_template"`
	BodyTemplate    *string   `json:"body_template"`
	Variables       *[]string `json:"variables"`
	Description     *string   `json:"description"`
	IsActive        *bool     `json:"is_active"`
}

// HandleList — GET /admin/notification-templates?channel=email&active=true.
func (h *NotificationTemplatesHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	channel := r.URL.Query().Get("channel")
	activeOnly := r.URL.Query().Get("active") == "true"
	items, err := h.List.Do(r.Context(), channel, activeOnly)
	if errors.Is(err, domain.ErrInvalidInput) {
		writeJSONErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		h.logErr(r, "list", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]notificationTemplateDTO, 0, len(items))
	for _, t := range items {
		out = append(out, notificationTemplateToDTO(t))
	}
	writeJSON(w, map[string]any{"items": out})
}

// HandleCreate — POST /admin/notification-templates.
func (h *NotificationTemplatesHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.requireAdminWithID(w, r)
	if !ok {
		return
	}
	var body createNotificationTemplateBody
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
	in := domain.NotificationTemplateUpsert{
		Slug:            strings.TrimSpace(body.Slug),
		Channel:         body.Channel,
		SubjectTemplate: body.SubjectTemplate,
		BodyTemplate:    body.BodyTemplate,
		Variables:       vars,
		Description:     body.Description,
		IsActive:        isActive,
		CreatedBy:       &uid,
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
	writeJSON(w, notificationTemplateToDTO(out))
}

// HandleUpdate — PATCH /admin/notification-templates/{id}.
func (h *NotificationTemplatesHandler) HandleUpdate(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body updateNotificationTemplateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	patch := domain.NotificationTemplatePatch{
		Channel:         body.Channel,
		SubjectTemplate: body.SubjectTemplate,
		BodyTemplate:    body.BodyTemplate,
		Variables:       body.Variables,
		Description:     body.Description,
		IsActive:        body.IsActive,
	}
	out, err := h.Update.Do(r.Context(), id, patch)
	if errors.Is(err, domain.ErrInvalidInput) {
		writeJSONErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeJSONErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		h.logErr(r, "update", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, notificationTemplateToDTO(out))
}

// HandleDeactivate — POST /admin/notification-templates/{id}/deactivate.
func (h *NotificationTemplatesHandler) HandleDeactivate(w http.ResponseWriter, r *http.Request) {
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
			writeJSONErr(w, http.StatusNotFound, "template not found")
			return
		}
		h.logErr(r, "deactivate", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// ── role gate ──────────────────────────────────────────────────────────

func (h *NotificationTemplatesHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	_, ok := h.requireAdminWithID(w, r)
	return ok
}

func (h *NotificationTemplatesHandler) requireAdminWithID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
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

func (h *NotificationTemplatesHandler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "admin.notification_templates."+op, slog.Any("err", err))
}
