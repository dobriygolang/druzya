package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"druz9/copilot/app"
	"druz9/shared/pkg/killswitch"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/shared/pkg/ratelimit"

	"github.com/go-chi/chi/v5"
)

// SuggestionHandler — plain REST for the auto-trigger (etap 3) path.
// Separate from Connect-RPC CopilotServer because this endpoint is:
//   - called from desktop main (not a Connect client);
//   - synchronous JSON in/out (no streaming to manage);
//   - intentionally excluded from proto (we don't want to regen
//     TS stubs for an endpoint that's effectively internal plumbing).
//
// Auth required — the LLM call is per-user, we want to pin rate
// limits to user id, not IP.
type SuggestionHandler struct {
	Suggest *app.Suggest
	// Limiter — 30/min per user. Caps auto-trigger spam from a
	// runaway transcript loop without cutting off legitimate
	// end-of-question bursts (typical meetings emit 1-2/min).
	Limiter *ratelimit.RedisFixedWindow
	// KillSwitch — operator can trip `killswitch:copilot_suggestion`
	// to stop auto-trigger burn if something goes wrong (runaway
	// transcript loop across many users).
	KillSwitch *killswitch.Switch
	Log        *slog.Logger
}

const suggestionLimitPerMin = 30

func (h *SuggestionHandler) Mount(r chi.Router) {
	r.Post("/copilot/suggestion", h.handleSuggest)
}

type suggestRequest struct {
	Question string `json:"question"`
	Context  string `json:"context"`
	Persona  string `json:"persona"`  // "meeting" | "interview" | ""
	Language string `json:"language"` // BCP-47 or ""
}

type suggestResponse struct {
	Text      string `json:"text"`
	Model     string `json:"model"`
	LatencyMs int    `json:"latency_ms"`
	TokensIn  int    `json:"tokens_in"`
	TokensOut int    `json:"tokens_out"`
}

func (h *SuggestionHandler) handleSuggest(w http.ResponseWriter, r *http.Request) {
	if h.KillSwitch != nil && h.KillSwitch.IsOn(r.Context(), killswitch.FeatureCopilotSuggestion) {
		w.Header().Set("Retry-After", "60")
		writeJSONErr(w, http.StatusServiceUnavailable, "suggestion temporarily disabled by operator")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONErr(w, http.StatusUnauthorized, "unauthenticated")
		return
	}

	if h.Limiter != nil {
		key := "rl:copilot:suggest:" + uid.String()
		res, err := h.Limiter.Allow(r.Context(), key, suggestionLimitPerMin, time.Minute)
		if err == nil && !res.Allowed {
			w.Header().Set("Retry-After", strconv.Itoa(res.RetryAfterSec))
			writeJSONErr(w, http.StatusTooManyRequests, "rate limited, retry in "+strconv.Itoa(res.RetryAfterSec)+"s")
			return
		}
	}

	// 32KB cap — question+context rarely exceed a few KB in practice.
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	defer r.Body.Close()

	var req suggestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONErr(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	if req.Question == "" {
		writeJSONErr(w, http.StatusBadRequest, "question is required")
		return
	}

	res, err := h.Suggest.Do(r.Context(), app.SuggestInput{
		UserID:   uid,
		Question: req.Question,
		Context:  req.Context,
		Persona:  req.Persona,
		Language: req.Language,
	})
	if err != nil {
		if h.Log != nil {
			h.Log.ErrorContext(r.Context(), "copilot.suggestion",
				slog.Any("err", err), slog.String("user", uid.String()))
		}
		writeJSONErr(w, http.StatusBadGateway, "suggestion failed")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(suggestResponse{
		Text:      res.Text,
		Model:     res.Model,
		LatencyMs: res.LatencyMs,
		TokensIn:  res.TokensIn,
		TokensOut: res.TokensOut,
	})
}
