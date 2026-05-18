// ab_experiments_handler.go — A/B experiment scaffold.
//
//	GET    /admin/ab-experiments                       → list
//	POST   /admin/ab-experiments                       → create (status defaults to draft)
//	POST   /admin/ab-experiments/{id}/status           → {"status":"running|paused|completed|draft"}
//
// Bucketing / assignment / stats live elsewhere.
package ports

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/admin/app"
	"druz9/admin/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ABExperimentsHandler aggregates UCs.
type ABExperimentsHandler struct {
	List      *app.ListABExperiments
	Create    *app.CreateABExperiment
	SetStatus *app.SetABExperimentStatus
	Log       *slog.Logger
}

// NewABExperimentsHandler wires UCs.
func NewABExperimentsHandler(
	list *app.ListABExperiments,
	create *app.CreateABExperiment,
	setStatus *app.SetABExperimentStatus,
	log *slog.Logger,
) *ABExperimentsHandler {
	return &ABExperimentsHandler{
		List:      list,
		Create:    create,
		SetStatus: setStatus,
		Log:       log,
	}
}

type abVariantDTO struct {
	Name   string `json:"name"`
	Weight int    `json:"weight"`
}

type abExperimentDTO struct {
	ID         string         `json:"id"`
	Slug       string         `json:"slug"`
	Hypothesis string         `json:"hypothesis"`
	Variants   []abVariantDTO `json:"variants"`
	MetricSlug string         `json:"metric_slug"`
	Status     string         `json:"status"`
	StartsAt   *string        `json:"starts_at,omitempty"`
	EndsAt     *string        `json:"ends_at,omitempty"`
	CreatedAt  string         `json:"created_at"`
	UpdatedAt  string         `json:"updated_at"`
}

func abExperimentToDTO(e domain.ABExperiment) abExperimentDTO {
	vars := make([]abVariantDTO, 0, len(e.Variants))
	for _, v := range e.Variants {
		vars = append(vars, abVariantDTO{Name: v.Name, Weight: v.Weight})
	}
	dto := abExperimentDTO{
		ID:         e.ID.String(),
		Slug:       e.Slug,
		Hypothesis: e.Hypothesis,
		Variants:   vars,
		MetricSlug: e.MetricSlug,
		Status:     e.Status,
		CreatedAt:  e.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:  e.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if e.StartsAt != nil {
		s := e.StartsAt.Format("2006-01-02T15:04:05Z07:00")
		dto.StartsAt = &s
	}
	if e.EndsAt != nil {
		s := e.EndsAt.Format("2006-01-02T15:04:05Z07:00")
		dto.EndsAt = &s
	}
	return dto
}

type createABExperimentBody struct {
	Slug       string         `json:"slug"`
	Hypothesis string         `json:"hypothesis"`
	Variants   []abVariantDTO `json:"variants"`
	MetricSlug string         `json:"metric_slug"`
	Status     string         `json:"status"`
	StartsAt   *string        `json:"starts_at"`
	EndsAt     *string        `json:"ends_at"`
}

type setStatusBody struct {
	Status string `json:"status"`
}

// HandleList — GET /admin/ab-experiments.
func (h *ABExperimentsHandler) HandleList(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	items, err := h.List.Do(r.Context())
	if err != nil {
		h.logErr(r, "list", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	out := make([]abExperimentDTO, 0, len(items))
	for _, e := range items {
		out = append(out, abExperimentToDTO(e))
	}
	writeJSON(w, map[string]any{"items": out})
}

// HandleCreate — POST /admin/ab-experiments.
func (h *ABExperimentsHandler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.requireAdminWithID(w, r)
	if !ok {
		return
	}
	var body createABExperimentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	vars := make([]domain.ABVariant, 0, len(body.Variants))
	for _, v := range body.Variants {
		vars = append(vars, domain.ABVariant{Name: v.Name, Weight: v.Weight})
	}
	var startsAt, endsAt *time.Time
	if body.StartsAt != nil && *body.StartsAt != "" {
		t, perr := time.Parse(time.RFC3339, *body.StartsAt)
		if perr != nil {
			writeJSONErr(w, http.StatusBadRequest, "invalid starts_at — RFC3339 required")
			return
		}
		startsAt = &t
	}
	if body.EndsAt != nil && *body.EndsAt != "" {
		t, perr := time.Parse(time.RFC3339, *body.EndsAt)
		if perr != nil {
			writeJSONErr(w, http.StatusBadRequest, "invalid ends_at — RFC3339 required")
			return
		}
		endsAt = &t
	}
	in := domain.ABExperimentUpsert{
		Slug:       strings.TrimSpace(body.Slug),
		Hypothesis: body.Hypothesis,
		Variants:   vars,
		MetricSlug: strings.TrimSpace(body.MetricSlug),
		Status:     body.Status,
		StartsAt:   startsAt,
		EndsAt:     endsAt,
		CreatedBy:  &uid,
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
	writeJSON(w, abExperimentToDTO(out))
}

// HandleSetStatus — POST /admin/ab-experiments/{id}/status.
func (h *ABExperimentsHandler) HandleSetStatus(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body setStatusBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.SetStatus.Do(r.Context(), id, body.Status)
	if errors.Is(err, domain.ErrInvalidInput) {
		writeJSONErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeJSONErr(w, http.StatusNotFound, "experiment not found")
		return
	}
	if err != nil {
		h.logErr(r, "set_status", err)
		writeJSONErr(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, abExperimentToDTO(out))
}

// ── role gate ──────────────────────────────────────────────────────────

func (h *ABExperimentsHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	_, ok := h.requireAdminWithID(w, r)
	return ok
}

func (h *ABExperimentsHandler) requireAdminWithID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
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

func (h *ABExperimentsHandler) logErr(r *http.Request, op string, err error) {
	if h.Log == nil {
		return
	}
	h.Log.ErrorContext(r.Context(), "admin.ab_experiments."+op, slog.Any("err", err))
}
