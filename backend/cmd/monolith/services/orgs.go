//go:build strategicwire
// +build strategicwire

// Package services — STRATEGIC SCAFFOLD wirer for the orgs bounded context.
//
// This file is intentionally guarded by the `strategicwire` build tag so it
// does NOT participate in the default monolith build (the orgs module is not
// yet listed in cmd/monolith/go.mod's require block, and adding it would
// force a `go mod tidy` we cannot run inside this scaffolding session).
//
// To enable wiring once Phase 1 of `docs/strategic/b2b-hrtech.md` lands:
//   1. Add `druz9/orgs v0.0.0-...` to backend/cmd/monolith/go.mod requires.
//   2. Add `replace druz9/orgs => ../../services/orgs`.
//   3. Run `go mod tidy` from backend/cmd/monolith/.
//   4. Remove the build tag on top of this file.
//   5. Append `services.NewOrgs(deps)` into the modules slice in
//      backend/cmd/monolith/bootstrap/bootstrap.go.
package services

import (
	"net/http"

	orgsApp "druz9/orgs/app"
	orgsPorts "druz9/orgs/ports"

	"github.com/go-chi/chi/v5"
)

// NewOrgs wires the B2B HR-tech bounded context.
//
// STRATEGIC SCAFFOLD: returns a Module that mounts only 501 stubs. Real
// implementation follows roadmap Phase 1 (~5 agent-sessions).
func NewOrgs(d Deps) *Module {
	// Repo will be: orgsInfra.NewPostgres(d.Pool) once infra is implemented.
	createOrg := orgsApp.NewCreateOrg(nil, d.Log)
	assignSeat := orgsApp.NewAssignSeat(nil, d.Log)
	revokeSeat := orgsApp.NewRevokeSeat(nil, d.Log)
	getDashboard := orgsApp.NewGetDashboard(nil, d.Log)

	h := orgsPorts.NewHandler(orgsPorts.Handler{
		CreateOrg:    createOrg,
		AssignSeat:   assignSeat,
		RevokeSeat:   revokeSeat,
		GetDashboard: getDashboard,
		Log:          d.Log,
	})

	return &Module{
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/orgs", http.HandlerFunc(h.HandleCreateOrg))
			r.Post("/orgs/{id}/seats", http.HandlerFunc(h.HandleAssignSeat))
			r.Delete("/orgs/{id}/seats/{seatId}", http.HandlerFunc(h.HandleRevokeSeat))
			r.Get("/orgs/{id}/dashboard", http.HandlerFunc(h.HandleGetDashboard))
		},
	}
}
