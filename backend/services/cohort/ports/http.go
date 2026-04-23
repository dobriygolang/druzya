// Package ports provides the HTTP surface stub for cohorts.
//
// STRATEGIC SCAFFOLD: every endpoint returns 501.
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"druz9/cohort/app"
)

// Handler bundles use cases.
type Handler struct {
	Create      *app.CreateCohort
	Join        *app.JoinCohort
	Leaderboard *app.GetLeaderboard
	Invite      *app.IssueInvite
	Log         *slog.Logger
}

// NewHandler constructs the HTTP handler. Panics on nil logger.
func NewHandler(h Handler) *Handler {
	if h.Log == nil {
		panic("cohort/ports: nil logger passed to NewHandler")
	}
	return &h
}

func (h *Handler) notImplemented(w http.ResponseWriter, op string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":    "not_implemented",
		"op":       op,
		"roadmap":  "docs/strategic/cohorts.md",
		"scaffold": "backend/services/cohort/README.md",
	})
}

// HandleCreate — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
func (h *Handler) HandleCreate(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "CreateCohort")
}

// HandleJoin — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
func (h *Handler) HandleJoin(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "JoinCohort")
}

// HandleLeaderboard — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
func (h *Handler) HandleLeaderboard(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "GetLeaderboard")
}

// HandleIssueInvite — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
func (h *Handler) HandleIssueInvite(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "IssueInvite")
}
