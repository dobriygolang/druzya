package services

import (
	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
	adminPorts "druz9/admin/ports"
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
func NewAdmin(d Deps) *Module {
	tasks := adminInfra.NewTasks(d.Pool)
	companies := adminInfra.NewCompanies(d.Pool)
	cfg := adminInfra.NewConfig(d.Pool)
	anticheat := adminInfra.NewAnticheat(d.Pool)
	broadcaster := adminInfra.NewRedisBroadcaster(d.Redis)

	dashboard := adminInfra.NewDashboard(d.Pool)
	users := adminInfra.NewUsers(d.Pool)
	reports := adminInfra.NewReports(d.Pool)
	incidents := adminInfra.NewIncidents(d.Pool)
	prober := adminInfra.NewStatusProber(d.Pool, d.Redis, incidents)

	server := adminPorts.NewAdminServer(
		&adminApp.ListTasks{Tasks: tasks},
		&adminApp.CreateTask{Tasks: tasks},
		&adminApp.UpdateTask{Tasks: tasks},
		&adminApp.ListCompanies{Companies: companies},
		&adminApp.UpsertCompany{Companies: companies},
		&adminApp.ListConfig{Config: cfg},
		&adminApp.UpdateConfig{Config: cfg, Broadcaster: broadcaster, Log: d.Log},
		&adminApp.ListAnticheat{Anticheat: anticheat},
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
	transcoder := mustTranscode("admin", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/admin/tasks", transcoder.ServeHTTP)
			r.Post("/admin/tasks", transcoder.ServeHTTP)
			r.Put("/admin/tasks/{taskId}", transcoder.ServeHTTP)
			r.Get("/admin/companies", transcoder.ServeHTTP)
			r.Post("/admin/companies", transcoder.ServeHTTP)
			r.Get("/admin/config", transcoder.ServeHTTP)
			r.Put("/admin/config/{key}", transcoder.ServeHTTP)
			r.Get("/admin/anticheat", transcoder.ServeHTTP)

			// Group B — dashboard / users / reports.
			r.Get("/admin/dashboard", transcoder.ServeHTTP)
			r.Get("/admin/users", transcoder.ServeHTTP)
			r.Post("/admin/users/{userId}/ban", transcoder.ServeHTTP)
			r.Post("/admin/users/{userId}/unban", transcoder.ServeHTTP)
			r.Get("/admin/reports", transcoder.ServeHTTP)

			// Public /status — auth bypass enforced in router.go.
			r.Get("/status", transcoder.ServeHTTP)
		},
	}
}
