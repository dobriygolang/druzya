// ai_models.go — facade-only wiring for the LLM model catalogue.
//
// Endpoint logic lives in services/admin/ports/ai_models.go (Connect server).
// model_id may include slashes (`mistralai/mistral-7b`); the proto annotation
// uses `{model_id=**}` so vanguard captures the full path segment.
package admin

import (
	"fmt"
	"net/http"

	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"

	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
	adminPorts "druz9/admin/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewAIModels wires the AI-model catalogue. Public list + admin CRUD live
// in the same Connect service; the chi mount layer applies the admin gate
// per-path.
func NewAIModels(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewAIModels(d.Pool)
	server := &adminPorts.AIModelServer{
		ListPublicUC: &adminApp.ListPublicAIModels{Models: repo},
		ListUC:       &adminApp.ListAIModels{Models: repo},
		CreateUC:     &adminApp.CreateAIModel{Models: repo},
		UpdateUC:     &adminApp.UpdateAIModel{Models: repo},
		ToggleUC:     &adminApp.ToggleAIModel{Models: repo},
		DeleteUC:     &adminApp.DeleteAIModel{Models: repo},
		Log:          d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewAIModelServiceHandler(server)
	transcoder := monolithServices.MustTranscode("ai_models", connectPath, connectHandler)

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
			// Public catalogue (anonymous-readable) — Cache-Control via
			// the transcoder's defaults.
			r.Get("/ai/models", transcoder.ServeHTTP)
			// Admin CRUD with `{model_id=**}` slash-id capture.
			r.Get("/admin/ai/models", adminGate)
			r.Post("/admin/ai/models", adminGate)
			r.Patch("/admin/ai/models/*", adminGate)
			r.Post("/admin/ai/models/*/toggle", adminGate)
			r.Delete("/admin/ai/models/*", adminGate)
		},
	}
}
