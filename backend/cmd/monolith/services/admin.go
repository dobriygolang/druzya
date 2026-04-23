package services

import (
	"log/slog"
	"net/http"

	adminApp "druz9/admin/app"
	"druz9/admin/domain"
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

	// chi-direct /api/v1/companies — public read-only listing for authenticated
	// users (no admin role check). Used by the /calendar EditDateModal company
	// picker so candidates can pick a real company without needing the admin
	// CMS surface. Adding it as a chi-direct handler avoids a proto regen and
	// keeps the admin-gated /admin/companies surface untouched (curators still
	// hit the proto endpoint to mutate).
	ch := &companiesPublicHandler{repo: companies, log: d.Log}

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

			// /companies — read-only listing for any authenticated user.
			// Powers the EditDateModal company picker on /calendar.
			r.Get("/companies", ch.list)
		},
	}
}

// companiesPublicHandler exposes a non-admin read-only view over the
// admin.CompanyRepo. The shape is intentionally minimal (id + name + slug)
// so it stays usable as a picker option without leaking admin metadata.
type companiesPublicHandler struct {
	repo domain.CompanyRepo
	log  *slog.Logger
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
	rows, err := h.repo.List(r.Context())
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
	writeJSON(w, http.StatusOK, out)
}
