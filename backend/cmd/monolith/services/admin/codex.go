// codex.go — facade-only wiring for the codex bounded context.
//
// All endpoint logic lives in services/admin/ports/codex.go (Connect server)
// and services/admin/{app,infra} (use cases + repo). This file only:
//  1. constructs use cases from the shared pool,
//  2. wires the admin auth gate on top of the transcoder,
//  3. mounts REST aliases (declared via google.api.http in codex.proto)
//     under the public + admin paths.
//
// The /codex/articles and /codex/categories listings are public — they share
// the Connect impl but mount under MountPublicREST so anonymous browsers
// hit them without bearer tokens. The wirer inserts a tiny URL-rewriter
// that forces active_only=true on the public path so anonymous callers can
// never request the admin view.
package admin

import (
	"net/http"

	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"

	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
	adminPorts "druz9/admin/ports"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"context"
	"fmt"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewCodex wires the codex bounded context.
func NewCodex(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewCodex(d.Pool)
	server := &adminPorts.CodexServer{
		ListArticlesUC:   &adminApp.ListCodexArticles{Codex: repo},
		GetArticleMetaUC: &adminApp.GetCodexArticleMeta{Codex: repo},
		CreateArticleUC:  &adminApp.CreateCodexArticle{Codex: repo},
		UpdateArticleUC:  &adminApp.UpdateCodexArticle{Codex: repo},
		DeleteArticleUC:  &adminApp.DeleteCodexArticle{Codex: repo},
		ToggleArticleUC:  &adminApp.ToggleCodexArticle{Codex: repo},
		ListCategoriesUC: &adminApp.ListCodexCategories{Codex: repo},
		CreateCategoryUC: &adminApp.CreateCodexCategory{Codex: repo},
		UpdateCategoryUC: &adminApp.UpdateCodexCategory{Codex: repo},
		DeleteCategoryUC: &adminApp.DeleteCodexCategory{Codex: repo},
		MemoryAppend:     buildMemoryAppendFn(d.IntelligenceMemory),
		Bus:              d.Bus,
		Log:              d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewCodexServiceHandler(server)
	transcoder := monolithServices.MustTranscode("codex", connectPath, connectHandler)

	// adminGate wraps the transcoder so admin-only paths require role=admin.
	adminGate := authServices.AdminGateHandler(transcoder)
	// adminListAdapter rewrites GET /admin/codex/{articles,categories} onto
	// the public ListArticles/ListCategories transcoder paths with
	// active_only=false, so the admin can fetch drafts. The proto contract
	// only declares one List handler per resource; this is the cheap way
	// to add an admin-visible variant without a proto regen.
	adminListAdapter := func(publicPath string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if _, err := authServices.RequireAdminInline(r); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(authServices.StatusForAuthErr(err))
				_, _ = fmt.Fprintf(w, `{"error":"%s"}`, err.Error())
				return
			}
			r.URL.Path = publicPath
			r.RequestURI = ""
			q := r.URL.Query()
			q.Set("active_only", "false")
			r.URL.RawQuery = q.Encode()
			transcoder.ServeHTTP(w, r)
		}
	}
	// publicListAdapter forces active_only=true regardless of incoming
	// query so anonymous callers hitting /codex/articles never get drafts.
	publicListAdapter := func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		q.Set("active_only", "true")
		r.URL.RawQuery = q.Encode()
		transcoder.ServeHTTP(w, r)
	}
	// publicCategoriesAdapter — same trick for /codex/categories.
	publicCategoriesAdapter := func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		q.Set("active_only", "true")
		r.URL.RawQuery = q.Encode()
		transcoder.ServeHTTP(w, r)
	}

	return &monolithServices.Module{
		ConnectPath:    connectPath,
		ConnectHandler: transcoder, // admin gate is applied per-path below
		MountPublicREST: func(r chi.Router) {
			r.Get("/codex/articles", publicListAdapter)
			r.Get("/codex/categories", publicCategoriesAdapter)
		},
		MountREST: func(r chi.Router) {
			// Auth-required tap (any logged-in user).
			r.Post("/codex/articles/{id}/open", transcoder.ServeHTTP)
			// Admin CRUD — admin role gate above the transcoder.
			// GET routes redirect to public List* transcoder path; the
			// proto-declared list method is reused with active_only=false.
			r.Get("/admin/codex/articles", adminListAdapter("/api/v1/codex/articles"))
			r.Post("/admin/codex/articles", adminGate)
			r.Patch("/admin/codex/articles/{id}", adminGate)
			r.Delete("/admin/codex/articles/{id}", adminGate)
			r.Post("/admin/codex/articles/{id}/active", adminGate)
			r.Get("/admin/codex/categories", adminListAdapter("/api/v1/codex/categories"))
			r.Post("/admin/codex/categories", adminGate)
			r.Patch("/admin/codex/categories/{slug}", adminGate)
			r.Delete("/admin/codex/categories/{slug}", adminGate)
		},
	}
}

// buildMemoryAppendFn adapts intelligence.Memory.AppendAsync to the small
// function signature the codex port consumes. Returns nil when memory is
// not wired so the port treats it as a no-op tap.
func buildMemoryAppendFn(memory *intelApp.Memory) adminPorts.MemoryAppendFn {
	if memory == nil {
		return nil
	}
	return func(ctx context.Context, userID, articleID uuid.UUID, slug, category, title string) {
		memory.AppendAsync(ctx, intelApp.AppendInput{
			UserID:  userID,
			Kind:    intelDomain.EpisodeCodexArticleOpened,
			Summary: fmt.Sprintf("opened: %s (%s)", title, category),
			Payload: map[string]any{
				"article_id": articleID.String(),
				"slug":       slug,
				"category":   category,
				"title":      title,
			},
			OccurredAt: time.Now().UTC(),
		})
	}
}
