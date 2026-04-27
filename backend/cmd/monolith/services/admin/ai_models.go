// ai_models.go — chi-direct `/ai/models` catalogue endpoint.
package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	adminApp "druz9/admin/app"
	adminDomain "druz9/admin/domain"
	adminInfra "druz9/admin/infra"
	monolithServices "druz9/cmd/monolith/services"

	"github.com/go-chi/chi/v5"
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

// NewAIModels wires the /ai/models module. No auth gate (public read);
// the parent router whitelists `/api/v1/ai/models`.
func NewAIModels(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewAIModels(d.Pool)
	uc := &adminApp.ListPublicAIModels{Models: repo}
	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			r.Get("/ai/models", aiModelsHandler(uc, d.Log))
		},
	}
}

// aiModelsHandler builds the http.HandlerFunc. Single SELECT against
// llm_models, no caching (5min staleTime on the client side is enough; the
// catalogue rarely changes and the row count is tiny — currently 6).
func aiModelsHandler(uc *adminApp.ListPublicAIModels, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var surface string
		if v := strings.TrimSpace(r.URL.Query().Get("use")); v != "" {
			surface = v
		}

		items, err := uc.Do(r.Context(), adminDomain.PublicAIModelFilter{Surface: surface})
		if err != nil {
			if errors.Is(err, adminDomain.ErrInvalidInput) {
				http.Error(w, "invalid use", http.StatusBadRequest)
				return
			}
			if log != nil {
				log.ErrorContext(r.Context(), "ai_models: query failed", slog.Any("err", err))
			}
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}

		out := make([]aiModel, 0, len(items))
		for _, it := range items {
			out = append(out, aiModel{
				ID:        it.ID,
				Label:     it.Label,
				Provider:  it.Provider,
				Tier:      it.Tier,
				Available: it.Available,
				IsVirtual: it.IsVirtual,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "max-age=300")
		_ = json.NewEncoder(w).Encode(aiModelsResponse{
			Available: len(out) > 0,
			Items:     out,
		})
	}
}
