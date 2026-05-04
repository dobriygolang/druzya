package admin

import (
	"log/slog"
	"net/http"

	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
	adminPorts "druz9/admin/ports"
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewAdmin wires the CMS / ops surface (bible §3.14). The role=admin gate
// lives INSIDE the server (AdminServer.requireAdmin); the gated middleware
// at the router layer only enforces bearer auth.
//
// One handler, two mount points: every /api/v1/admin/* route lives under
// the gated REST group (bearer auth + admin role check inside handler).
// The PUBLIC /api/v1/status route, while served by the same AdminServer,
// is also routed through the REST transcoder but whitelisted in
// router.go's restAuthGate — it bypasses bearer auth entirely.
func NewAdmin(d monolithServices.Deps) *monolithServices.Module {
	companies := adminInfra.NewCompanies(d.Pool)
	cfg := adminInfra.NewConfig(d.Pool)
	broadcaster := adminInfra.NewRedisBroadcaster(d.Redis)

	dashboard := adminInfra.NewDashboard(d.Pool)
	users := adminInfra.NewUsers(d.Pool)
	reports := adminInfra.NewReports(d.Pool)
	incidents := adminInfra.NewIncidents(d.Pool)
	prober := adminInfra.NewStatusProber(d.Pool, d.Redis, incidents)

	server := adminPorts.NewAdminServer(
		&adminApp.ListConfig{Config: cfg},
		&adminApp.UpdateConfig{Config: cfg, Broadcaster: broadcaster, Log: d.Log},
		d.Log,
	)
	server.GetDashboardUC = &adminApp.GetDashboard{Repo: dashboard, Cache: d.Redis, Log: d.Log}
	server.ListUsersUC = &adminApp.ListUsers{Users: users}
	server.BanUserUC = &adminApp.BanUser{Users: users, Cache: d.Redis, Log: d.Log}
	server.UnbanUserUC = &adminApp.UnbanUser{Users: users, Cache: d.Redis, Log: d.Log}
	server.ListReportsUC = &adminApp.ListReports{Reports: reports}
	server.GetStatusUC = &adminApp.GetStatus{
		Prober: prober, Incidents: incidents, Cache: d.Redis, Log: d.Log,
	}

	connectPath, connectHandler := druz9v1connect.NewAdminServiceHandler(server)
	transcoder := monolithServices.MustTranscode("admin", connectPath, connectHandler)

	// chi-direct /api/v1/companies — public read-only listing for authenticated
	// users (no admin role check). Used by the /calendar EditDateModal company
	// picker so candidates can pick a real company without needing the admin
	// CMS surface. Adding it as a chi-direct handler avoids a proto regen and
	// keeps the admin-gated /admin/companies surface untouched (curators still
	// hit the proto endpoint to mutate).
	ch := &companiesPublicHandler{
		listCompanies: &adminApp.ListCompanies{Companies: companies},
		log:           d.Log,
	}

	// Observability handler — Wave 3.5.x admin panels (Tracks /
	// English HR / Mock-block). Chi-direct read-only surface, mirrors
	// AtlasAdminHandler's pattern in profile/.
	observ := adminPorts.NewObservabilityHandler(adminInfra.NewObservability(d.Pool), d.Log)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Pivot 2026-05-04: orphan admin REST aliases (no frontend
			// caller) удалены — /admin/tasks*, /admin/companies*,
			// /admin/anticheat. Соответствующие proto RPCs остаются в
			// .proto до планового regen-cleanup'а (низкий приоритет).
			// /admin/mock/companies / /admin/mock/tasks (живые ручки)
			// поднимаются из mock_interview/ports.
			r.Get("/admin/config", transcoder.ServeHTTP)
			r.Put("/admin/config/{key}", transcoder.ServeHTTP)

			// Group B — dashboard / users / reports.
			r.Get("/admin/dashboard", transcoder.ServeHTTP)
			r.Get("/admin/users", transcoder.ServeHTTP)
			r.Post("/admin/users/{userId}/ban", transcoder.ServeHTTP)
			r.Post("/admin/users/{userId}/unban", transcoder.ServeHTTP)
			r.Get("/admin/reports", transcoder.ServeHTTP)

			// Public /status — auth bypass enforced in router.go.
			r.Get("/status", transcoder.ServeHTTP)

			// /companies — read-only listing for any authenticated user.
			// Powers the EditDateModal company picker on /calendar.
			r.Get("/companies", ch.list)

			// Wave 3.5.x admin observability — admin-only read-only
			// aggregations. Role check happens INSIDE each handler.
			r.Get("/admin/observability/tracks", observ.HandleTracks)
			r.Get("/admin/observability/english-hr", observ.HandleEnglishHR)
			r.Get("/admin/observability/mock-block", observ.HandleMockBlock)
		},
	}
}

// companiesPublicHandler exposes a non-admin read-only view over the
// admin ListCompanies use case. The shape is intentionally minimal
// (id + name + slug) so it stays usable as a picker option without
// leaking admin metadata.
type companiesPublicHandler struct {
	listCompanies *adminApp.ListCompanies
	log           *slog.Logger
}

type companyOptionDTO struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type companiesResponse struct {
	Items []companyOptionDTO `json:"items"`
}

func (h *companiesPublicHandler) list(w http.ResponseWriter, r *http.Request) {
	rows, err := h.listCompanies.Do(r.Context())
	if err != nil {
		h.log.ErrorContext(r.Context(), "companies.list", slog.Any("err", err))
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	out := companiesResponse{Items: make([]companyOptionDTO, 0, len(rows))}
	for _, row := range rows {
		out.Items = append(out.Items, companyOptionDTO{
			ID:   row.ID.String(),
			Slug: row.Slug,
			Name: row.Name,
		})
	}
	monolithServices.WriteJSON(w, http.StatusOK, out)
}
