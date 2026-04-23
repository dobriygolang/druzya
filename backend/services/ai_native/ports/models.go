// models.go — GET /api/v1/ai/models. Returns the list of LLM models the
// backend can ACTUALLY route through OpenRouter, marking each one's tier
// (free/premium). The frontend uses this to render the AI-opponent picker
// dynamically — hardcoded model lists were a frequent source of "I see X
// in the UI but the backend can't dispatch it" production bugs (issue #4).
//
// Wave-9 refactor: the catalogue is no longer a hardcoded enum. It is
// served from the llm_models table (migration 00033) so admins can add a
// new OpenRouter id without a code deploy. The handler still honours the
// "OPENROUTER_API_KEY missing → empty array + available=false" contract:
// without an API key the backend can't dispatch ANY model regardless of
// what the registry contains.
//
// Anti-fallback policy:
//   - When OPENROUTER_API_KEY is empty, returns Available=false + empty.
//   - When the registry table is empty, returns Available=true + empty
//     (operator must seed at least one model via the admin tab).
//   - We deliberately do NOT fall back to a baked-in hardcoded list when
//     the DB is unreachable — surfacing the error is correct behaviour
//     (frontend hides the panel).
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/ai_native/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ModelDescriptor is the JSON shape returned to the frontend.
//
// id        — OpenRouter model identifier ("openai/gpt-4o", …). Round-trips
//
//	back into CreateNativeRequest.llm_model without translation.
//
// label     — Human-friendly name shown in the UI ("GPT-4o").
// provider  — Vendor ("OpenAI", "Anthropic", "Google"). Used for grouping.
// tier      — "free" | "premium". Premium is gated behind subscription.
// available — Whether the backend can dispatch this id right now. Today
//
//	this mirrors is_enabled; reserved for future per-model
//	health probes (e.g. OpenRouter returning 503 for one route).
type ModelDescriptor struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Provider  string `json:"provider"`
	Tier      string `json:"tier"`
	Available bool   `json:"available"`
}

// ModelsResponse wraps the catalogue plus a top-level availability flag the
// frontend can use to short-circuit to "AI features disabled" without having
// to parse an empty array.
type ModelsResponse struct {
	Available bool              `json:"available"`
	Items     []ModelDescriptor `json:"items"`
}

// userTierResolver returns the subscription tier for a user id. We accept
// the existing ai_native UserRepo because it already knows how to map a
// uuid to free/premium — no new query needed.
type userTierResolver interface {
	Get(ctx context.Context, id uuid.UUID) (domain.UserContext, error)
}

// ModelsHandler is wired in cmd/monolith/services/ai_native.go. It is a
// thin adapter over the registry repo — the actual catalogue lives in
// llm_models. Available reflects whether OPENROUTER_API_KEY is set; when
// false we short-circuit and never hit the DB.
type ModelsHandler struct {
	Available bool
	Repo      domain.LLMModelRepo
	Users     userTierResolver
	Log       *slog.Logger
}

// NewModelsHandler returns a handler. apiKeyPresent must reflect the
// presence of the OpenRouter API key. repo is required (anti-fallback —
// no in-memory shadow catalogue). users may be nil if the caller only
// renders unauthenticated views; in that case premium models are always
// hidden.
func NewModelsHandler(apiKeyPresent bool, repo domain.LLMModelRepo, users userTierResolver, log *slog.Logger) *ModelsHandler {
	if log == nil {
		// Anti-fallback: a silent nil logger hides production bugs.
		// Refuse to start instead of swapping in a noop.
		panic("ai_native.ports.NewModelsHandler: logger is required")
	}
	if repo == nil {
		panic("ai_native.ports.NewModelsHandler: repo is required (anti-fallback policy: no in-memory model catalogue)")
	}
	return &ModelsHandler{
		Available: apiKeyPresent,
		Repo:      repo,
		Users:     users,
		Log:       log,
	}
}

// Mount registers /ai/models on the given chi router. Caller adds the
// /api/v1 prefix.
func (h *ModelsHandler) Mount(r chi.Router) {
	r.Get("/ai/models", h.handleList)
}

// handleList writes the response. The route is mounted under the gated
// REST router but tolerates missing user context (landing-page picker is
// rendered before sign-in completes — the gate may pass for a public
// alias). When unauthenticated, only free models are returned.
//
// ?use=arena|insight|mock — optional filter by feature surface.
func (h *ModelsHandler) handleList(w http.ResponseWriter, r *http.Request) {
	resp := ModelsResponse{Available: h.Available, Items: []ModelDescriptor{}}
	if !h.Available {
		writeModelsJSON(w, resp)
		return
	}

	use := domain.LLMModelUse(r.URL.Query().Get("use"))
	if use != "" && !use.IsValid() {
		http.Error(w, "invalid use parameter", http.StatusBadRequest)
		return
	}

	rows, err := h.Repo.List(r.Context(), domain.LLMModelFilter{
		OnlyEnabled: true,
		Use:         use,
	})
	if err != nil {
		h.Log.ErrorContext(r.Context(), "ai_native.models: list failed", slog.Any("err", err))
		http.Error(w, "models unavailable", http.StatusInternalServerError)
		return
	}

	includePremium := h.callerIsPremium(r)
	out := make([]ModelDescriptor, 0, len(rows))
	for _, m := range rows {
		if m.IsPremium() && !includePremium {
			continue
		}
		out = append(out, ModelDescriptor{
			ID:        m.ModelID,
			Label:     m.Label,
			Provider:  m.Provider,
			Tier:      string(m.Tier),
			Available: m.IsEnabled,
		})
	}
	resp.Items = out
	writeModelsJSON(w, resp)
}

// callerIsPremium resolves the caller's tier via the existing UserRepo.
// Anonymous callers (no uid in context) are treated as free — they
// shouldn't see premium models at all in the picker. Errors fall back to
// free as the conservative default.
func (h *ModelsHandler) callerIsPremium(r *http.Request) bool {
	if h.Users == nil {
		return false
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		return false
	}
	uc, err := h.Users.Get(r.Context(), uid)
	if err != nil {
		// A missing subscription row is treated as free by Users.Get,
		// but a hard read failure shouldn't reveal premium models.
		if !errors.Is(err, domain.ErrNotFound) {
			h.Log.WarnContext(r.Context(), "ai_native.models: tier lookup failed", slog.Any("err", err))
		}
		return false
	}
	return isPremiumPlan(uc.Subscription)
}

// isPremiumPlan mirrors the existing premium gate used elsewhere in
// ai_native: anything other than the free plan unlocks paid models.
// Centralised here so the catalogue handler doesn't need to know about
// every paid tier slug.
func isPremiumPlan(p enums.SubscriptionPlan) bool {
	return p != enums.SubscriptionPlanFree && p != ""
}

func writeModelsJSON(w http.ResponseWriter, resp ModelsResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}
