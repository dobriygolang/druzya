// personas.go — facade-only wiring for the personas bounded context.
//
// Endpoint logic lives in services/admin/ports/personas.go (Connect server)
// and services/admin/{app,infra}. This file:
//  1. constructs use cases from the shared pool,
//  2. wires the admin auth gate on top of the transcoder,
//  3. mounts REST aliases (declared via google.api.http in personas.proto)
//     under the public + admin paths.
//
// /personas (list) is public-readable; the chi mount forces active_only=true
// on the public path so anonymous callers never see disabled rows.
package admin

import (
	"net/http"

	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"

	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
	adminPorts "druz9/admin/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewPersonas wires the personas bounded context.
func NewPersonas(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewPersonas(d.Pool)
	server := &adminPorts.PersonaServer{
		ListPersonasUC:  &adminApp.ListPersonas{Personas: repo},
		CreatePersonaUC: &adminApp.CreatePersona{Personas: repo},
		UpdatePersonaUC: &adminApp.UpdatePersona{Personas: repo},
		TogglePersonaUC: &adminApp.TogglePersona{Personas: repo},
		DeletePersonaUC: &adminApp.DeletePersona{Personas: repo},
		Log:             d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewPersonaServiceHandler(server)
	transcoder := monolithServices.MustTranscode("personas", connectPath, connectHandler)

	adminGate := authServices.AdminGateHandler(transcoder)
	publicListAdapter := func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		q.Set("active_only", "true")
		r.URL.RawQuery = q.Encode()
		transcoder.ServeHTTP(w, r)
	}

	return &monolithServices.Module{
		ConnectPath:    connectPath,
		ConnectHandler: transcoder,
		MountPublicREST: func(r chi.Router) {
			// Copilot UI consumes this anonymously to render mode chips.
			r.Get("/personas", publicListAdapter)
		},
		MountREST: func(r chi.Router) {
			r.Get("/admin/personas", adminGate)
			r.Post("/admin/personas", adminGate)
			r.Patch("/admin/personas/{id}", adminGate)
			r.Patch("/admin/personas/{id}/toggle", adminGate)
			r.Delete("/admin/personas/{id}", adminGate)
		},
	}
}
