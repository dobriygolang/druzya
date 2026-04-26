// codex.go — chi-direct CRUD over the `codex_articles` table.
//
// Public surface:
//   GET /api/v1/codex/articles            (open — codex caching tier)
//
// Admin surface (requires role=admin in JWT):
//   POST   /api/v1/admin/codex/articles
//   PATCH  /api/v1/admin/codex/articles/{id}
//   DELETE /api/v1/admin/codex/articles/{id}
//   POST   /api/v1/admin/codex/articles/{id}/active
//
// Categories stay hardcoded on the frontend (icon + colour are
// presentation, not data); this module owns articles only.
package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type codexArticleDTO struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Href        string `json:"href"`
	Source      string `json:"source"`
	ReadMin     int    `json:"read_min"`
	SortOrder   int    `json:"sort_order"`
	Active      bool   `json:"active"`
}

const codexArticleCols = `id::text, slug, title, description, category, href, source, read_min, sort_order, active`

// NewCodex wires both the public read and the admin CRUD routes.
func NewCodex(d Deps) *Module {
	h := &codexHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountPublicREST: func(r chi.Router) {
			// Anonymous-readable: codex is content for unauthenticated visitors too.
			r.Get("/codex/articles", h.listPublic)
		},
		MountREST: func(r chi.Router) {
			// Admin CRUD lives behind the gated /api/v1.
			r.Get("/admin/codex/articles", h.listAdmin)
			r.Post("/admin/codex/articles", h.create)
			r.Patch("/admin/codex/articles/{id}", h.update)
			r.Delete("/admin/codex/articles/{id}", h.delete)
			r.Post("/admin/codex/articles/{id}/active", h.toggleActive)
		},
	}
}

type codexHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func (h *codexHandler) listPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.pool.Query(r.Context(),
		`SELECT `+codexArticleCols+` FROM codex_articles WHERE active = true ORDER BY category, sort_order ASC`)
	if err != nil {
		h.fail(w, r, err, "list_public")
		return
	}
	defer rows.Close()
	out := make([]codexArticleDTO, 0, 32)
	for rows.Next() {
		row, err := scanCodexRow(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *codexHandler) listAdmin(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	rows, err := h.pool.Query(r.Context(),
		`SELECT `+codexArticleCols+` FROM codex_articles ORDER BY category, sort_order ASC`)
	if err != nil {
		h.fail(w, r, err, "list_admin")
		return
	}
	defer rows.Close()
	out := make([]codexArticleDTO, 0, 32)
	for rows.Next() {
		row, err := scanCodexRow(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

type codexUpsertBody struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Href        string `json:"href"`
	Source      string `json:"source"`
	ReadMin     int    `json:"read_min"`
	SortOrder   int    `json:"sort_order"`
	Active      *bool  `json:"active,omitempty"`
}

func (b codexUpsertBody) validate() error {
	if b.Slug == "" || b.Title == "" || b.Category == "" || b.Href == "" {
		return errors.New("slug, title, category, href are required")
	}
	return nil
}

func (h *codexHandler) create(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	var body codexUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if err := body.validate(); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	row := h.pool.QueryRow(r.Context(), `
		INSERT INTO codex_articles (slug, title, description, category, href, source, read_min, sort_order, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING `+codexArticleCols,
		body.Slug, body.Title, body.Description, body.Category,
		body.Href, body.Source, body.ReadMin, body.SortOrder, active)
	out, err := scanCodexRow(row)
	if err != nil {
		h.fail(w, r, err, "create")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(out)
}

func (h *codexHandler) update(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	var body codexUpsertBody
	if dErr := json.NewDecoder(r.Body).Decode(&body); dErr != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if vErr := body.validate(); vErr != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, vErr.Error()), http.StatusBadRequest)
		return
	}
	active := true
	if body.Active != nil {
		active = *body.Active
	}
	row := h.pool.QueryRow(r.Context(), `
		UPDATE codex_articles SET
		  slug=$2, title=$3, description=$4, category=$5,
		  href=$6, source=$7, read_min=$8, sort_order=$9, active=$10,
		  updated_at = now()
		WHERE id = $1
		RETURNING `+codexArticleCols,
		sharedpg.UUID(id), body.Slug, body.Title, body.Description, body.Category,
		body.Href, body.Source, body.ReadMin, body.SortOrder, active)
	out, err := scanCodexRow(row)
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

func (h *codexHandler) toggleActive(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	var body struct {
		Active bool `json:"active"`
	}
	if dErr := json.NewDecoder(r.Body).Decode(&body); dErr != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	tag, err := h.pool.Exec(r.Context(),
		`UPDATE codex_articles SET active = $2, updated_at = now() WHERE id = $1`,
		sharedpg.UUID(id), body.Active)
	if err != nil {
		h.fail(w, r, err, "toggle")
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *codexHandler) delete(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM codex_articles WHERE id = $1`, sharedpg.UUID(id))
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

func scanCodexRow(row pgx.Row) (codexArticleDTO, error) {
	var d codexArticleDTO
	err := row.Scan(&d.ID, &d.Slug, &d.Title, &d.Description, &d.Category,
		&d.Href, &d.Source, &d.ReadMin, &d.SortOrder, &d.Active)
	if err != nil {
		return d, fmt.Errorf("codex.scan: %w", err)
	}
	return d, nil
}

func (h *codexHandler) fail(w http.ResponseWriter, r *http.Request, err error, op string) {
	if h.log != nil {
		h.log.ErrorContext(r.Context(), "codex: "+op+" failed", slog.Any("err", err))
	}
	http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
}
