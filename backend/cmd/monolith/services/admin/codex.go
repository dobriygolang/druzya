// codex.go — chi-direct CRUD over the `codex_articles` table.
package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	adminApp "druz9/admin/app"
	adminDomain "druz9/admin/domain"
	adminInfra "druz9/admin/infra"
	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
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

func dtoFromCodexArticle(a adminDomain.CodexArticle) codexArticleDTO {
	return codexArticleDTO{
		ID: a.ID, Slug: a.Slug, Title: a.Title, Description: a.Description,
		Category: a.Category, Href: a.Href, Source: a.Source,
		ReadMin: a.ReadMin, SortOrder: a.SortOrder, Active: a.Active,
	}
}

func dtoFromCodexCategory(c adminDomain.CodexCategory) codexCategoryDTO {
	return codexCategoryDTO{
		Slug: c.Slug, Label: c.Label, Description: c.Description,
		SortOrder: c.SortOrder, Active: c.Active,
	}
}

// NewCodex wires both the public read and the admin CRUD routes.
// `memory` is optional — when non-nil we write a `codex_article_opened`
// episode each time the user POSTs /codex/articles/{id}/open. Coach
// uses these episodes to spot reading patterns ("часто читаешь sysdesign
// → попробуй mock с этим этапом").
func NewCodex(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewCodex(d.Pool)
	h := &codexHandler{
		listArticles:   &adminApp.ListCodexArticles{Codex: repo},
		createArticle:  &adminApp.CreateCodexArticle{Codex: repo},
		updateArticle:  &adminApp.UpdateCodexArticle{Codex: repo},
		toggleArticle:  &adminApp.ToggleCodexArticle{Codex: repo},
		deleteArticle:  &adminApp.DeleteCodexArticle{Codex: repo},
		getArticleMeta: &adminApp.GetCodexArticleMeta{Codex: repo},
		listCategories: &adminApp.ListCodexCategories{Codex: repo},
		createCategory: &adminApp.CreateCodexCategory{Codex: repo},
		updateCategory: &adminApp.UpdateCodexCategory{Codex: repo},
		deleteCategory: &adminApp.DeleteCodexCategory{Codex: repo},
		log:            d.Log,
		memory:         d.IntelligenceMemory,
	}
	return &monolithServices.Module{
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
			r.Post("/admin/codex/categories", h.createCategoryHandler)
			r.Patch("/admin/codex/categories/{slug}", h.updateCategoryHandler)
			r.Delete("/admin/codex/categories/{slug}", h.deleteCategoryHandler)
		},
	}
}

type codexHandler struct {
	listArticles   *adminApp.ListCodexArticles
	createArticle  *adminApp.CreateCodexArticle
	updateArticle  *adminApp.UpdateCodexArticle
	toggleArticle  *adminApp.ToggleCodexArticle
	deleteArticle  *adminApp.DeleteCodexArticle
	getArticleMeta *adminApp.GetCodexArticleMeta
	listCategories *adminApp.ListCodexCategories
	createCategory *adminApp.CreateCodexCategory
	updateCategory *adminApp.UpdateCodexCategory
	deleteCategory *adminApp.DeleteCodexCategory
	log            *slog.Logger
	memory         *intelApp.Memory
}

func (h *codexHandler) listPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.listArticles.Do(r.Context(), true)
	if err != nil {
		h.fail(w, r, err, "list_public")
		return
	}
	out := make([]codexArticleDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, dtoFromCodexArticle(row))
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *codexHandler) listAdmin(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	rows, err := h.listArticles.Do(r.Context(), false)
	if err != nil {
		h.fail(w, r, err, "list_admin")
		return
	}
	out := make([]codexArticleDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, dtoFromCodexArticle(row))
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

func (b codexUpsertBody) toUpsert() adminDomain.CodexArticleUpsert {
	return adminDomain.CodexArticleUpsert{
		Slug: b.Slug, Title: b.Title, Description: b.Description,
		Category: b.Category, Href: b.Href, Source: b.Source,
		ReadMin: b.ReadMin, SortOrder: b.SortOrder, Active: b.Active,
	}
}

func (h *codexHandler) create(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	var body codexUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	out, err := h.createArticle.Do(r.Context(), body.toUpsert())
	if err != nil {
		if errors.Is(err, adminDomain.ErrInvalidInput) {
			http.Error(w, `{"error":"slug, title, category, href are required"}`, http.StatusBadRequest)
			return
		}
		h.fail(w, r, err, "create")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(dtoFromCodexArticle(out))
}

func (h *codexHandler) update(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
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
	out, err := h.updateArticle.Do(r.Context(), id, body.toUpsert())
	if err != nil {
		if errors.Is(err, adminDomain.ErrInvalidInput) {
			http.Error(w, `{"error":"slug, title, category, href are required"}`, http.StatusBadRequest)
			return
		}
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "update")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(dtoFromCodexArticle(out))
}

func (h *codexHandler) toggleActive(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
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
	if err := h.toggleArticle.Do(r.Context(), id, body.Active); err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "toggle")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *codexHandler) delete(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, `{"error":"invalid id"}`, http.StatusBadRequest)
		return
	}
	if err := h.deleteArticle.Do(r.Context(), id); err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "delete")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *codexHandler) fail(w http.ResponseWriter, r *http.Request, err error, op string) {
	if h.log != nil {
		h.log.ErrorContext(r.Context(), "codex: "+op+" failed", slog.Any("err", err))
	}
	http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
}

// ── Categories ───────────────────────────────────────────────────────

func (h *codexHandler) listCategoriesPublic(w http.ResponseWriter, r *http.Request) {
	rows, err := h.listCategories.Do(r.Context(), true)
	if err != nil {
		h.fail(w, r, err, "list_categories_public")
		return
	}
	out := make([]codexCategoryDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, dtoFromCodexCategory(row))
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=600")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *codexHandler) listCategoriesAdmin(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	rows, err := h.listCategories.Do(r.Context(), false)
	if err != nil {
		h.fail(w, r, err, "list_categories_admin")
		return
	}
	out := make([]codexCategoryDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, dtoFromCodexCategory(row))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": out})
}

func (h *codexHandler) createCategoryHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	var body codexCategoryDTO
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid body"}`, http.StatusBadRequest)
		return
	}
	in := adminDomain.CodexCategory{
		Slug: body.Slug, Label: body.Label, Description: body.Description,
		SortOrder: body.SortOrder, Active: body.Active,
	}
	if err := h.createCategory.Do(r.Context(), in); err != nil {
		if errors.Is(err, adminDomain.ErrInvalidInput) {
			http.Error(w, `{"error":"slug and label are required"}`, http.StatusBadRequest)
			return
		}
		h.fail(w, r, err, "create_category")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(body)
}

func (h *codexHandler) updateCategoryHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
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
	in := adminDomain.CodexCategory{
		Slug: slug, Label: body.Label, Description: body.Description,
		SortOrder: body.SortOrder, Active: body.Active,
	}
	if err := h.updateCategory.Do(r.Context(), slug, in); err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "update_category")
		return
	}
	body.Slug = slug
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func (h *codexHandler) deleteCategoryHandler(w http.ResponseWriter, r *http.Request) {
	if _, err := authServices.RequireAdminInline(r); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), authServices.StatusForAuthErr(err))
		return
	}
	slug := chi.URLParam(r, "slug")
	if err := h.deleteCategory.Do(r.Context(), slug); err != nil {
		var inUse *adminApp.ErrCategoryInUse
		if errors.As(err, &inUse) {
			http.Error(w, fmt.Sprintf(`{"error":"%d articles still use this category — reassign first"}`, inUse.Count),
				http.StatusConflict)
			return
		}
		if errors.Is(err, adminDomain.ErrNotFound) {
			http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
			return
		}
		h.fail(w, r, err, "delete_category")
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
	meta, err := h.getArticleMeta.Do(r.Context(), id)
	if err != nil {
		if errors.Is(err, adminDomain.ErrNotFound) {
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
