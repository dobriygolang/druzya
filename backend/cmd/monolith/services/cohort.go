//go:build strategicwire
// +build strategicwire

// Package services — STRATEGIC SCAFFOLD wirer for cohort.
//
// Guarded by `strategicwire` build tag. See orgs.go for activation steps.
package services

import (
	"net/http"

	cohortApp "druz9/cohort/app"
	cohortPorts "druz9/cohort/ports"

	"github.com/go-chi/chi/v5"
)

// NewCohort wires the cohort bounded context.
//
// STRATEGIC SCAFFOLD: returns 501 stubs. See docs/strategic/cohorts.md.
func NewCohort(d Deps) *Module {
	create := cohortApp.NewCreateCohort(nil, d.Log)
	join := cohortApp.NewJoinCohort(nil, d.Log)
	leaderboard := cohortApp.NewGetLeaderboard(nil, d.Log)
	invite := cohortApp.NewIssueInvite(nil, d.Log)

	h := cohortPorts.NewHandler(cohortPorts.Handler{
		Create:      create,
		Join:        join,
		Leaderboard: leaderboard,
		Invite:      invite,
		Log:         d.Log,
	})

	return &Module{
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/cohorts", http.HandlerFunc(h.HandleCreate))
			r.Get("/cohorts/{slug}", http.HandlerFunc(h.HandleLeaderboard))
			r.Post("/cohorts/{slug}/join", http.HandlerFunc(h.HandleJoin))
			r.Post("/cohorts/{id}/invites", http.HandlerFunc(h.HandleIssueInvite))
		},
	}
}
