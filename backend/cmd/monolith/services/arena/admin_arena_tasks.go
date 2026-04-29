// admin_arena_tasks.go — facade-only wiring for the admin Arena task CMS.
//
// Endpoint logic lives in services/arena/ports/admin_tasks.go (Connect server).
// Auth gate (admin role) is applied above the transcoder per-path.
package arena

import (
	"fmt"
	"net/http"

	arenaApp "druz9/arena/app"
	arenaInfra "druz9/arena/infra"
	arenaPorts "druz9/arena/ports"
	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewAdminArenaTasks wires the admin Arena task CMS module.
func NewAdminArenaTasks(d monolithServices.Deps) *monolithServices.Module {
	repo := arenaInfra.NewAdminTasks(d.Pool)
	server := &arenaPorts.AdminTaskServer{
		ListUC:   &arenaApp.ListAdminTasks{Repo: repo},
		GetUC:    &arenaApp.GetAdminTask{Repo: repo},
		CreateUC: &arenaApp.CreateAdminTask{Repo: repo},
		UpdateUC: &arenaApp.UpdateAdminTask{Repo: repo},
		ToggleUC: &arenaApp.ToggleAdminTaskActive{Repo: repo},
		DeleteUC: &arenaApp.DeleteAdminTask{Repo: repo},
		Log:      d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewArenaAdminTaskServiceHandler(server)
	transcoder := monolithServices.MustTranscode("arena_admin_tasks", connectPath, connectHandler)

	adminGate := func(w http.ResponseWriter, r *http.Request) {
		if _, err := authServices.RequireAdminInline(r); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(authServices.StatusForAuthErr(err))
			_, _ = fmt.Fprintf(w, `{"error":"%s"}`, err.Error())
			return
		}
		transcoder.ServeHTTP(w, r)
	}

	return &monolithServices.Module{
		ConnectPath:    connectPath,
		ConnectHandler: transcoder,
		MountREST: func(r chi.Router) {
			r.Get("/admin/arena/tasks", adminGate)
			r.Get("/admin/arena/tasks/{id}", adminGate)
			r.Post("/admin/arena/tasks", adminGate)
			r.Patch("/admin/arena/tasks/{id}", adminGate)
			r.Post("/admin/arena/tasks/{id}/active", adminGate)
			r.Delete("/admin/arena/tasks/{id}", adminGate)
		},
	}
}
