// current_match.go — `GET /api/v1/arena/match/current` returns the user's
// most recent non-finished match (searching|confirming|active) so the SPA
// can poll /arena while in the queue and navigate to /arena/match/:id the
// moment the matchmaker pairs them up.
//
// Why a chi-direct REST handler and not a Connect-RPC method:
//   - The proto contract for `arena.ArenaService` already has 6 RPCs; adding
//     a 7th forces a `make gen-proto` across every Connect bundle for what
//     is essentially a single SELECT lookup. Same rationale used by
//     practice.go and streak_calendar_handler.go in daily/.
//   - Polling endpoints want minimal serialisation overhead and a tiny JSON
//     shape that matches exactly what the SPA renders — easier to evolve
//     here than via proto.
//
// Auth: bearer-gated by the existing chi auth middleware (the route is
// mounted under the auth-protected /api/v1 prefix; not in publicPaths).
//
// Anti-fallback policy:
//   - Repo errors propagate as 500 (no silent empty fallback).
//   - "no current match" returns 404, not 200+empty — the SPA explicitly
//     handles 404 to mean "still searching" vs 200 to mean "go to match".
package ports

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"druz9/arena/domain"
	"druz9/shared/enums"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// CurrentMatchFinder is the narrow port the handler needs from the repo.
// Implemented by *infra.Postgres via the new FindCurrentMatch method.
type CurrentMatchFinder interface {
	// FindCurrentMatch returns the user's latest non-finished match
	// (searching/confirming/active). Returns domain.ErrNotFound when there
	// is no such match.
	FindCurrentMatch(ctx context.Context, userID uuid.UUID) (domain.Match, error)
}

// CurrentMatchHandler is the http.Handler for GET /api/v1/arena/match/current.
type CurrentMatchHandler struct {
	Repo CurrentMatchFinder
	Log  *slog.Logger
}

// NewCurrentMatchHandler builds the handler. log is required (anti-fallback).
func NewCurrentMatchHandler(repo CurrentMatchFinder, log *slog.Logger) *CurrentMatchHandler {
	if log == nil {
		panic("arena.ports.NewCurrentMatchHandler: log is required (anti-fallback policy: no silent slog.Default fallback)")
	}
	if repo == nil {
		panic("arena.ports.NewCurrentMatchHandler: repo is required")
	}
	return &CurrentMatchHandler{Repo: repo, Log: log}
}

type currentMatchResponse struct {
	MatchID string `json:"match_id"`
	Status  string `json:"status"`
	Mode    string `json:"mode"`
	Section string `json:"section"`
}

// ServeHTTP implements http.Handler.
func (h *CurrentMatchHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	match, err := h.Repo.FindCurrentMatch(r.Context(), uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeJSONError(w, http.StatusNotFound, "no current match")
			return
		}
		h.Log.ErrorContext(r.Context(), "arena.current_match: repo failed", slog.Any("err", err))
		writeJSONError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	// Cache-Control: no-store — we WANT the SPA to poll fresh; this endpoint
	// is the polling pivot.
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(currentMatchResponse{
		MatchID: match.ID.String(),
		Status:  string(match.Status),
		Mode:    string(match.Mode),
		Section: string(match.Section),
	})
	_ = enums.MatchStatusActive // keep enums import for future status-name remap
}

// writeJSONError mirrors helper used by sibling chi-direct handlers
// (discovery_handler.go etc.). Kept local so this file is fully self-
// contained — moving to a shared http util is a separate cleanup.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{"message": msg},
	})
}
