// Package ports provides the HTTP surface stub for mentor_session.
//
// STRATEGIC SCAFFOLD: every endpoint returns 501.
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"druz9/mentor_session/app"
)

// Handler bundles the use cases.
type Handler struct {
	List     *app.ListMentors
	Request  *app.RequestSession
	Accept   *app.AcceptSession
	Complete *app.CompleteSession
	Log      *slog.Logger
}

// NewHandler constructs the HTTP handler. Panics on nil logger.
func NewHandler(h Handler) *Handler {
	if h.Log == nil {
		panic("mentor_session/ports: nil logger passed to NewHandler")
	}
	return &h
}

func (h *Handler) notImplemented(w http.ResponseWriter, op string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":    "not_implemented",
		"op":       op,
		"roadmap":  "docs/strategic/mentor-marketplace.md",
		"scaffold": "backend/services/mentor_session/README.md",
	})
}

// HandleListMentors — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (h *Handler) HandleListMentors(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "ListMentors")
}

// HandleRequestSession — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (h *Handler) HandleRequestSession(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "RequestSession")
}

// HandleAcceptSession — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (h *Handler) HandleAcceptSession(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "AcceptSession")
}

// HandleCompleteSession — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (h *Handler) HandleCompleteSession(w http.ResponseWriter, _ *http.Request) {
	h.notImplemented(w, "CompleteSession")
}
