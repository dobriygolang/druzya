// stats.go — facade-only wiring for the public stats / languages /
// onboarding-preview surface. Endpoint logic lives in
// services/admin/ports/stats.go.
package admin

import (
	"net/http"

	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
	adminPorts "druz9/admin/ports"
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewStats wires the public stats / languages / onboarding-preview-kata
// endpoints. Anonymous-readable; mounted under MountPublicREST.
//
// Cache-Control headers are layered on top of the transcoder per-path
// because vanguard does not propagate REST-level cache hints (the source
// of truth is google.api.http annotations, which doesn't model caching).
func NewStats(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewStats(d.Pool, d.Log)
	server := &adminPorts.StatsServer{
		PublicStatsUC: &adminApp.PublicStats{Stats: repo},
		Incidents:     adminInfra.NewIncidents(d.Pool),
		Now:           d.Now,
		Log:           d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewStatsServiceHandler(server)
	transcoder := monolithServices.MustTranscode("stats", connectPath, connectHandler)

	withCache := func(maxAge string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "public, max-age="+maxAge)
			transcoder.ServeHTTP(w, r)
		}
	}

	return &monolithServices.Module{
		ConnectPath:    connectPath,
		ConnectHandler: transcoder,
		MountPublicREST: func(r chi.Router) {
			r.Get("/stats/public", transcoder.ServeHTTP)
			r.Get("/languages", withCache("300"))
			r.Get("/onboarding/preview-kata", withCache("3600"))
			// History buckets — short cache for the spark-bars on /status.
			r.Get("/status/history", withCache("60"))
		},
	}
}
