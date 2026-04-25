// ai_models.go — chi-direct `/ai/models` catalogue endpoint.
//
// Background: the original ai_native service that owned this route was
// removed (see comment in bootstrap.go around the deleted import). The
// frontend (Arena AI-opponent picker, Settings AI-pref panel, mock-
// interview model badge) still consumes `GET /api/v1/ai/models`. We rebuilt
// it as a slim public read-through over `llm_models` rather than reviving
// the full ai_native CRUD surface — that surface is still admin-served
// elsewhere if/when needed.
//
// Public read (whitelisted in router.go publicPaths) so unauthenticated
// pages can render the upsell banner. The actual LLM call gate lives in
// llmchain.TierCovers — this endpoint is purely the catalogue contract.

package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// aiModel — wire shape for the public catalogue. Must stay in sync with
// frontend/src/lib/queries/ai.ts AIModel.
type aiModel struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Provider  string `json:"provider"`
	Tier      string `json:"tier"`
	Available bool   `json:"available"`
	IsVirtual bool   `json:"is_virtual,omitempty"`
}

type aiModelsResponse struct {
	Available bool      `json:"available"`
	Items     []aiModel `json:"items"`
}

// allowedUseSurfaces — `?use=...` filter values. The DB columns mirror
// these names. Anything else returns 400.
var allowedUseSurfaces = map[string]string{
	"arena":     "use_for_arena",
	"insight":   "use_for_insight",
	"mock":      "use_for_mock",
	"vacancies": "use_for_vacancies",
}

// NewAIModels wires the /ai/models module. No auth gate (public read);
// the parent router whitelists `/api/v1/ai/models`.
func NewAIModels(d Deps) *Module {
	return &Module{
		MountREST: func(r chi.Router) {
			r.Get("/ai/models", aiModelsHandler(d.Pool, d.Log))
		},
	}
}

// aiModelsHandler builds the http.HandlerFunc. Single SELECT against
// llm_models, no caching (5min staleTime on the client side is enough; the
// catalogue rarely changes and the row count is tiny — currently 6).
func aiModelsHandler(pool *pgxpool.Pool, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var useFilter string
		if v := strings.TrimSpace(r.URL.Query().Get("use")); v != "" {
			col, ok := allowedUseSurfaces[v]
			if !ok {
				http.Error(w, "invalid use", http.StatusBadRequest)
				return
			}
			useFilter = col
		}

		const baseQuery = `
			SELECT model_id, label, provider, tier, COALESCE(is_virtual, FALSE)
			  FROM llm_models
			 WHERE is_enabled = TRUE`
		query := baseQuery
		if useFilter != "" {
			// Column name is whitelisted via allowedUseSurfaces so direct
			// interpolation is safe — never reachable from user input.
			query += fmt.Sprintf(" AND %s = TRUE", useFilter)
		}
		query += " ORDER BY sort_order ASC, model_id ASC LIMIT 50"

		rows, err := pool.Query(r.Context(), query)
		if err != nil {
			if log != nil {
				log.ErrorContext(r.Context(), "ai_models: query failed", slog.Any("err", err))
			}
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		items := make([]aiModel, 0, 16)
		for rows.Next() {
			var (
				modelID, label, provider, tier string
				isVirtual                      bool
			)
			if err := rows.Scan(&modelID, &label, &provider, &tier, &isVirtual); err != nil {
				if log != nil {
					log.ErrorContext(r.Context(), "ai_models: scan failed", slog.Any("err", err))
				}
				http.Error(w, "internal", http.StatusInternalServerError)
				return
			}
			items = append(items, aiModel{
				ID:        modelID,
				Label:     label,
				Provider:  provider,
				Tier:      tier,
				Available: true,
				IsVirtual: isVirtual,
			})
		}
		if err := rows.Err(); err != nil {
			if log != nil {
				log.ErrorContext(r.Context(), "ai_models: rows err", slog.Any("err", err))
			}
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "max-age=300")
		_ = json.NewEncoder(w).Encode(aiModelsResponse{
			Available: len(items) > 0,
			Items:     items,
		})
	}
}

// _ keeps the context import used when log helpers are added later — the
// build will trim it if unused so this is a no-op today.
var _ = context.Background
