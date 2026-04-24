// personas.go — GET /api/v1/personas. Returns the catalogue for the
// desktop Copilot's persona picker. Mirrors models.go (llm_models
// public handler) — same DTO/response-wrapper shape so the frontend
// can reuse fetch helpers.
//
// No per-user filtering today: personas are a flat catalogue, not tier-
// gated. If premium-only personas become a thing, add a filter here
// analogous to callerIsPremium in models.go.
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"druz9/ai_native/domain"

	"github.com/go-chi/chi/v5"
)

// PersonaDTO is the wire shape. JSON tags map to the desktop's
// shared/personas.ts types (to be regenerated once the renderer moves
// to this endpoint — see phase plan in session notes).
type PersonaDTO struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	Hint          string `json:"hint"`
	IconEmoji     string `json:"icon_emoji"`
	BrandGradient string `json:"brand_gradient"`
	SuggestedTask string `json:"suggested_task,omitempty"`
	SystemPrompt  string `json:"system_prompt"`
	SortOrder     int    `json:"sort_order"`
}

// PersonasResponse wraps the catalogue so the JSON can grow later
// (pagination, versioning tag, feature flags) without breaking the
// desktop client's typed shape.
type PersonasResponse struct {
	Items []PersonaDTO `json:"items"`
}

// PersonasHandler is wired in cmd/monolith/services/ai_native.go next
// to ModelsHandler. Gated by the standard bearer auth at the router
// (persona catalogue is authenticated-only because the desktop only
// ever fetches it from a logged-in session).
type PersonasHandler struct {
	Repo domain.PersonaRepo
	Log  *slog.Logger
}

// NewPersonasHandler validates deps. Anti-fallback: nil → panic.
func NewPersonasHandler(repo domain.PersonaRepo, log *slog.Logger) *PersonasHandler {
	if repo == nil {
		panic("ai_native.ports.NewPersonasHandler: repo is required")
	}
	if log == nil {
		panic("ai_native.ports.NewPersonasHandler: logger is required")
	}
	return &PersonasHandler{Repo: repo, Log: log}
}

// Mount registers /personas on the given chi router. Caller adds /api/v1.
func (h *PersonasHandler) Mount(r chi.Router) {
	r.Get("/personas", h.handleList)
}

func (h *PersonasHandler) handleList(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Repo.List(r.Context(), domain.PersonaFilter{OnlyEnabled: true})
	if err != nil {
		h.Log.ErrorContext(r.Context(), "ai_native.personas: list failed", slog.Any("err", err))
		http.Error(w, "personas unavailable", http.StatusInternalServerError)
		return
	}
	out := make([]PersonaDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, PersonaDTO{
			ID:            p.ID,
			Label:         p.Label,
			Hint:          p.Hint,
			IconEmoji:     p.IconEmoji,
			BrandGradient: p.BrandGradient,
			SuggestedTask: p.SuggestedTask,
			SystemPrompt:  p.SystemPrompt,
			SortOrder:     p.SortOrder,
		})
	}
	resp := PersonasResponse{Items: out}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
