//go:build strategicwire
// +build strategicwire

// Package services — STRATEGIC SCAFFOLD wirer for mentor_session.
//
// Guarded by `strategicwire` build tag — see orgs.go for the activation
// procedure (add module to cmd/monolith/go.mod, run go mod tidy, drop tag).
package services

import (
	"net/http"

	mentorApp "druz9/mentor_session/app"
	mentorPorts "druz9/mentor_session/ports"

	"github.com/go-chi/chi/v5"
)

// NewMentorSession wires the mentor marketplace bounded context.
//
// STRATEGIC SCAFFOLD: returns 501 stubs. See docs/strategic/mentor-marketplace.md.
func NewMentorSession(d Deps) *Module {
	list := mentorApp.NewListMentors(nil, d.Log)
	request := mentorApp.NewRequestSession(nil, d.Log)
	accept := mentorApp.NewAcceptSession(nil, d.Log)
	complete := mentorApp.NewCompleteSession(nil, d.Log)

	h := mentorPorts.NewHandler(mentorPorts.Handler{
		List:     list,
		Request:  request,
		Accept:   accept,
		Complete: complete,
		Log:      d.Log,
	})

	return &Module{
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/mentors", http.HandlerFunc(h.HandleListMentors))
			r.Post("/mentors/sessions", http.HandlerFunc(h.HandleRequestSession))
			r.Post("/mentors/sessions/{id}/accept", http.HandlerFunc(h.HandleAcceptSession))
			r.Post("/mentors/sessions/{id}/complete", http.HandlerFunc(h.HandleCompleteSession))
		},
	}
}
