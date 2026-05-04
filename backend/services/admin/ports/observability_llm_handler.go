// observability_llm_handler.go — Phase 12.5 /admin/observability/llm endpoint.
//
// Surfaces ObservabilityReader (Phase 12.5 service.go) — task rollups +
// latest eval runs. Chi-direct (не Connect-RPC).
package ports

import (
	"log/slog"
	"net/http"
	"strconv"

	"druz9/admin/app"
)

type AdminObservabilityLLMHandler struct {
	Reader *app.ObservabilityReader
	Log    *slog.Logger
}

func NewAdminObservabilityLLMHandler(reader *app.ObservabilityReader, log *slog.Logger) *AdminObservabilityLLMHandler {
	return &AdminObservabilityLLMHandler{Reader: reader, Log: log}
}

// GET /admin/observability/llm?days=7
func (h *AdminObservabilityLLMHandler) HandleRollups(w http.ResponseWriter, r *http.Request) {
	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil {
			days = n
		}
	}
	out, err := h.Reader.ListTaskRollups(r.Context(), days)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, out)
}

// GET /admin/observability/eval-runs
func (h *AdminObservabilityLLMHandler) HandleEvalRuns(w http.ResponseWriter, r *http.Request) {
	out, err := h.Reader.LatestEvalRuns(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, out)
}
