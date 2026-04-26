// admin_personas.go — chi-direct admin CRUD over `personas`.
//
// Public list lives elsewhere (services/personas.go-style read-through);
// this owns the admin write side. Frontend lives at
// frontend/src/pages/admin/PersonasPanel.tsx and was previously hidden
// because the backend admin endpoints didn't exist.
package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

const adminPersonaCols = `
	id, label, hint, icon_emoji, brand_gradient, suggested_task, system_prompt,
	sort_order, is_enabled,
	to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

// NewAdminPersonas wires the admin write surface for personas.
func NewAdminPersonas(d Deps) *Module {
	h := &adminPersonasHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountPublicREST: func(r chi.Router) {
			// Public read — copilot UI consumes it before admin features
			// are reachable.
			r.Get("/personas", h.listPublic)
		},
		MountREST: func(r chi.Router) {
			r.Get("/admin/personas", h.list)
			r.Post("/admin/personas", h.create)
			r.Patch("/admin/personas/{id}", h.update)
			r.Patch("/admin/personas/{id}/toggle", h.toggle)
			r.Delete("/admin/personas/{id}", h.delete)
		},
	}
}

type adminPersonasHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func (h *adminPersonasHandler) listPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.pool.Query(r.Context(),
		`SELECT `+adminPersonaCols+` FROM personas WHERE is_enabled = TRUE ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		h.fail(w, r, err, "list_public")
		return
	}
	defer rows.Close()
	out := make([]adminPersonaDTO, 0, 8)
	for rows.Next() {
		row, err := scanAdminPersona(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *adminPersonasHandler) list(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	rows, err := h.pool.Query(r.Context(),
		`SELECT `+adminPersonaCols+` FROM personas ORDER BY sort_order ASC, id ASC`)
	if err != nil {
		h.fail(w, r, err, "list")
		return
	}
	defer rows.Close()
	out := make([]adminPersonaDTO, 0, 8)
	for rows.Next() {
		row, err := scanAdminPersona(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
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

func (h *adminPersonasHandler) create(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	var body adminPersonaUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if body.ID == "" || body.Label == "" {
		http.Error(w, `{"error":"id and label required"}`, http.StatusBadRequest)
		return
	}
	enabled := true
	if body.IsEnabled != nil {
		enabled = *body.IsEnabled
	}
	sort := 100
	if body.SortOrder != nil {
		sort = *body.SortOrder
	}
	row := h.pool.QueryRow(r.Context(), `
		INSERT INTO personas (
			id, label, hint, icon_emoji, brand_gradient, suggested_task, system_prompt,
			sort_order, is_enabled
		) VALUES ($1,$2,$3,COALESCE(NULLIF($4,''), '💬'),$5,$6,$7,$8,$9)
		RETURNING `+adminPersonaCols,
		body.ID, body.Label, body.Hint, body.IconEmoji, body.BrandGradient,
		body.SuggestedTask, body.SystemPrompt, sort, enabled)
	out, err := scanAdminPersona(row)
	if err != nil {
		h.fail(w, r, err, "create")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(out)
}

func (h *adminPersonasHandler) update(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
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
	row := h.pool.QueryRow(r.Context(), `
		UPDATE personas SET
		  label = COALESCE(NULLIF($2,''), label),
		  hint = COALESCE(NULLIF($3,''), hint),
		  icon_emoji = COALESCE(NULLIF($4,''), icon_emoji),
		  brand_gradient = COALESCE(NULLIF($5,''), brand_gradient),
		  suggested_task = COALESCE(NULLIF($6,''), suggested_task),
		  system_prompt = COALESCE(NULLIF($7,''), system_prompt),
		  sort_order = COALESCE($8, sort_order),
		  is_enabled = COALESCE($9, is_enabled),
		  updated_at = now()
		WHERE id = $1
		RETURNING `+adminPersonaCols,
		id, body.Label, body.Hint, body.IconEmoji, body.BrandGradient,
		body.SuggestedTask, body.SystemPrompt, body.SortOrder, body.IsEnabled)
	out, err := scanAdminPersona(row)
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

func (h *adminPersonasHandler) toggle(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	id := chi.URLParam(r, "id")
	row := h.pool.QueryRow(r.Context(), `
		UPDATE personas SET is_enabled = NOT is_enabled, updated_at = now()
		WHERE id = $1
		RETURNING `+adminPersonaCols, id)
	out, err := scanAdminPersona(row)
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

func (h *adminPersonasHandler) delete(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	id := chi.URLParam(r, "id")
	tag, err := h.pool.Exec(r.Context(), `DELETE FROM personas WHERE id = $1`, id)
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

func scanAdminPersona(row pgx.Row) (adminPersonaDTO, error) {
	var d adminPersonaDTO
	err := row.Scan(
		&d.ID, &d.Label, &d.Hint, &d.IconEmoji, &d.BrandGradient,
		&d.SuggestedTask, &d.SystemPrompt, &d.SortOrder, &d.IsEnabled,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return d, fmt.Errorf("scan persona: %w", err)
	}
	return d, nil
}

func (h *adminPersonasHandler) fail(w http.ResponseWriter, r *http.Request, err error, op string) {
	if h.log != nil {
		h.log.ErrorContext(r.Context(), "admin.personas: "+op+" failed", slog.Any("err", err))
	}
	http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
}
