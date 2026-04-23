// models.go — GET /api/v1/ai/models. Returns the list of LLM models the
// backend can ACTUALLY route through OpenRouter, marking each one's tier
// (free/premium). The frontend uses this to render the AI-opponent picker
// dynamically — hardcoded model lists were a frequent source of "I see X
// in the UI but the backend can't dispatch it" production bugs (issue #4).
//
// Anti-fallback policy: when OPENROUTER_API_KEY is empty, the endpoint
// returns an empty `items` array AND `available=false`. Frontend hides the
// AI-opponent panel in that case rather than rendering fake choices.
package ports

import (
	"encoding/json"
	"net/http"

	"druz9/shared/enums"

	"github.com/go-chi/chi/v5"
)

// ModelDescriptor is the JSON shape returned to the frontend.
//
// id        — OpenRouter model identifier ("openai/gpt-4o", …). Matches
//
//	enums.LLMModel exactly so callers can round-trip it back into
//	CreateNativeRequest.llm_model without further translation.
//
// label     — Human-friendly name shown in the UI ("GPT-4o").
// provider  — Vendor ("OpenAI", "Anthropic", "Google"). Used for grouping.
// tier      — "free" | "premium". premium is gated behind subscription.
// available — Always true today (OpenRouter routes every registered id when
//
//	the API key is set). Reserved for future per-model health checks.
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

// ModelsHandler is wired in cmd/monolith/services/ai_native.go. It is a
// pure-data adapter — no domain dependencies — so a missing OpenRouter key
// can be expressed via the Available flag at construction time.
type ModelsHandler struct {
	Available bool
}

// NewModelsHandler returns a handler. apiKeyPresent should be true iff the
// OpenRouter API key is set in config; the handler will then advertise the
// canonical free + premium catalogue.
func NewModelsHandler(apiKeyPresent bool) *ModelsHandler {
	return &ModelsHandler{Available: apiKeyPresent}
}

// Mount registers /ai/models on the given chi router. Caller adds the
// /api/v1 prefix.
func (h *ModelsHandler) Mount(r chi.Router) {
	r.Get("/ai/models", h.handleList)
}

// handleList writes the response. Public read — no auth required so the
// landing-page selector can render before sign-in.
func (h *ModelsHandler) handleList(w http.ResponseWriter, _ *http.Request) {
	resp := ModelsResponse{Available: h.Available, Items: []ModelDescriptor{}}
	if h.Available {
		resp.Items = canonicalModels()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// canonicalModels is the single source of truth for the UI catalogue. The
// ids here match enums.LLMModel exactly so the value the user picks can be
// passed straight back into CreateNativeRequest.
//
// Tier classification mirrors enums.LLMModel.IsPremium() (do NOT diverge —
// gating is enforced server-side at session creation).
func canonicalModels() []ModelDescriptor {
	type entry struct {
		id       enums.LLMModel
		label    string
		provider string
	}
	all := []entry{
		{enums.LLMModelGPT4oMini, "GPT-4o mini", "OpenAI"},
		{enums.LLMModelMistral7B, "Mistral 7B", "Mistral"},
		{enums.LLMModelGPT4o, "GPT-4o", "OpenAI"},
		{enums.LLMModelClaudeSonnet4, "Claude Sonnet 4", "Anthropic"},
		{enums.LLMModelGeminiPro, "Gemini Pro", "Google"},
	}
	out := make([]ModelDescriptor, 0, len(all))
	for _, e := range all {
		tier := "free"
		if e.id.IsPremium() {
			tier = "premium"
		}
		out = append(out, ModelDescriptor{
			ID:        string(e.id),
			Label:     e.label,
			Provider:  e.provider,
			Tier:      tier,
			Available: true,
		})
	}
	return out
}
