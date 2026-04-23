// Package ports provides the HTTP surface stub for the orgs bounded context.
//
// STRATEGIC SCAFFOLD: every endpoint returns 501 Not Implemented with a
// JSON body pointing operators at the roadmap doc. We intentionally do NOT
// register these on the monolith router until the use cases are real, to
// avoid leaking 501s into production. See ../README.md.
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"druz9/orgs/app"
)

// Handler bundles the HTTP-facing dependencies.
type Handler struct {
	CreateOrg    *app.CreateOrg
	AssignSeat   *app.AssignSeat
	RevokeSeat   *app.RevokeSeat
	GetDashboard *app.GetDashboard
	Log          *slog.Logger
}

// NewHandler constructs the HTTP handler. Anti-fallback: panics on nil
// logger.
func NewHandler(h Handler) *Handler {
	if h.Log == nil {
		panic("orgs/ports: nil logger passed to NewHandler")
	}
	return &h
}

// notImplemented writes a structured 501 response.
//
// STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (h *Handler) notImplemented(w http.ResponseWriter, op string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":    "not_implemented",
		"op":       op,
		"roadmap":  "docs/strategic/b2b-hrtech.md",
		"scaffold": "backend/services/orgs/README.md",
	})
}

// HandleCreateOrg — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (h *Handler) HandleCreateOrg(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "CreateOrg")
}

// HandleAssignSeat — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (h *Handler) HandleAssignSeat(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "AssignSeat")
}

// HandleRevokeSeat — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (h *Handler) HandleRevokeSeat(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "RevokeSeat")
}

// HandleGetDashboard — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (h *Handler) HandleGetDashboard(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "GetDashboard")
}
