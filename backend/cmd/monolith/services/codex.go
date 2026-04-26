// codex.go — chi-direct CRUD over the `codex_articles` table.
//
// Public surface:
//
//	GET /api/v1/codex/articles            (open — codex caching tier)
//
// Admin surface (requires role=admin in JWT):
//
//	POST   /api/v1/admin/codex/articles
//	PATCH  /api/v1/admin/codex/articles/{id}
//	DELETE /api/v1/admin/codex/articles/{id}
//	POST   /api/v1/admin/codex/articles/{id}/active
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
	"time"

	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type codexCategoryDTO struct {
	Slug        string `json:"slug"`
	Label       string `json:"label"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
	Active      bool   `json:"active"`
}

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
// `memory` is optional — when non-nil we write a `codex_article_opened`
// episode each time the user POSTs /codex/articles/{id}/open. Coach
// uses these episodes to spot reading patterns ("часто читаешь sysdesign
// → попробуй mock с этим этапом").
func NewCodex(d Deps) *Module {
	h := &codexHandler{pool: d.Pool, log: d.Log, memory: d.IntelligenceMemory}
	return &Module{
		MountPublicREST: func(r chi.Router) {
			// Anonymous-readable: codex is content for unauthenticated visitors too.
			r.Get("/codex/articles", h.listPublic)
			r.Get("/codex/categories", h.listCategoriesPublic)
		},
		MountREST: func(r chi.Router) {
			// Open-article tap (auth'd users only — no point storing
			// anonymous reads in Coach memory).
			r.Post("/codex/articles/{id}/open", h.openArticle)
			// Admin CRUD lives behind the gated /api/v1.
			r.Get("/admin/codex/articles", h.listAdmin)
			r.Post("/admin/codex/articles", h.create)
			r.Patch("/admin/codex/articles/{id}", h.update)
			r.Delete("/admin/codex/articles/{id}", h.delete)
			r.Post("/admin/codex/articles/{id}/active", h.toggleActive)
			// Categories admin CRUD (presentation lookup-table; small).
			r.Get("/admin/codex/categories", h.listCategoriesAdmin)
			r.Post("/admin/codex/categories", h.createCategory)
			r.Patch("/admin/codex/categories/{slug}", h.updateCategory)
			r.Delete("/admin/codex/categories/{slug}", h.deleteCategory)
		},
	}
}

type codexHandler struct {
	pool   *pgxpool.Pool
	log    *slog.Logger
	memory *intelApp.Memory
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

// ── Categories ───────────────────────────────────────────────────────

const codexCategoryCols = `slug, label, description, sort_order, active`

func (h *codexHandler) listCategoriesPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.pool.Query(r.Context(),
		`SELECT `+codexCategoryCols+` FROM codex_categories WHERE active = true ORDER BY sort_order ASC`)
	if err != nil {
		h.fail(w, r, err, "list_categories_public")
		return
	}
	defer rows.Close()
	out := make([]codexCategoryDTO, 0, 8)
	for rows.Next() {
		var c codexCategoryDTO
		if scanErr := rows.Scan(&c.Slug, &c.Label, &c.Description, &c.SortOrder, &c.Active); scanErr != nil {
			continue
		}
		out = append(out, c)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=600")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *codexHandler) listCategoriesAdmin(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	rows, err := h.pool.Query(r.Context(),
		`SELECT `+codexCategoryCols+` FROM codex_categories ORDER BY sort_order ASC`)
	if err != nil {
		h.fail(w, r, err, "list_categories_admin")
		return
	}
	defer rows.Close()
	out := make([]codexCategoryDTO, 0, 8)
	for rows.Next() {
		var c codexCategoryDTO
		if scanErr := rows.Scan(&c.Slug, &c.Label, &c.Description, &c.SortOrder, &c.Active); scanErr != nil {
			continue
		}
		out = append(out, c)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *codexHandler) createCategory(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	var body codexCategoryDTO
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	if body.Slug == "" || body.Label == "" {
		http.Error(w, `{"error":"slug and label are required"}`, http.StatusBadRequest)
		return
	}
	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO codex_categories (slug, label, description, sort_order, active)
		VALUES ($1, $2, $3, $4, $5)`,
		body.Slug, body.Label, body.Description, body.SortOrder, body.Active)
	if err != nil {
		h.fail(w, r, err, "create_category")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(body)
}

func (h *codexHandler) updateCategory(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	slug := chi.URLParam(r, "slug")
	if slug == "" {
		http.Error(w, `{"error":"slug required"}`, http.StatusBadRequest)
		return
	}
	var body codexCategoryDTO
	if dErr := json.NewDecoder(r.Body).Decode(&body); dErr != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	tag, err := h.pool.Exec(r.Context(), `
		UPDATE codex_categories SET
		  label = $2, description = $3, sort_order = $4, active = $5,
		  updated_at = now()
		WHERE slug = $1`,
		slug, body.Label, body.Description, body.SortOrder, body.Active)
	if err != nil {
		h.fail(w, r, err, "update_category")
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	body.Slug = slug
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func (h *codexHandler) deleteCategory(w http.ResponseWriter, r *http.Request) {
	if _, err := requireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), statusForAuthErr(err))
		return
	}
	slug := chi.URLParam(r, "slug")
	// Refuse if any article still uses this category — admin must reassign first.
	var count int
	if err := h.pool.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM codex_articles WHERE category = $1`, slug).Scan(&count); err == nil && count > 0 {
		http.Error(w, fmt.Sprintf(`{"error":"%d articles still use this category — reassign first"}`, count),
			http.StatusConflict)
		return
	}
	tag, err := h.pool.Exec(r.Context(),
		`DELETE FROM codex_categories WHERE slug = $1`, slug)
	if err != nil {
		h.fail(w, r, err, "delete_category")
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Open-article episode ─────────────────────────────────────────────

// openArticle is the Coach memory tap. Frontend POSTs here right after
// opening an external link so we can write a `codex_article_opened`
// episode and the Daily Coach narrative can spot reading patterns
// ("ты часто читаешь sysdesign — пора попробовать mock этого этапа").
func (h *codexHandler) openArticle(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	var meta struct {
		Slug     string `json:"slug"`
		Title    string `json:"title"`
		Category string `json:"category"`
	}
	if err := h.pool.QueryRow(r.Context(),
		`SELECT slug, title, category FROM codex_articles WHERE id = $1 AND active = true`,
		sharedpg.UUID(id)).Scan(&meta.Slug, &meta.Title, &meta.Category); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "open_article_lookup")
		return
	}
	if h.memory != nil {
		h.memory.AppendAsync(r.Context(), intelApp.AppendInput{
			UserID:  uid,
			Kind:    intelDomain.EpisodeCodexArticleOpened,
			Summary: fmt.Sprintf("opened: %s (%s)", meta.Title, meta.Category),
			Payload: map[string]any{
				"article_id": id.String(),
				"slug":       meta.Slug,
				"category":   meta.Category,
				"title":      meta.Title,
			},
			OccurredAt: time.Now().UTC(),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
