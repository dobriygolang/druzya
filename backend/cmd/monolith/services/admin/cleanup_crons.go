// cleanup_crons.go — facade-only wiring for the admin retention sweep.
//
// All SQL + loop logic lives in services/admin (infra.CleanupRepo +
// app.CleanupRunner). This file just composes the runner and registers it
// as a Background entry on the Module.
package admin

import (
	"context"

	monolithServices "druz9/cmd/monolith/services"

	adminApp "druz9/admin/app"
	adminInfra "druz9/admin/infra"
)

// NewCleanupCrons wires the sweep module. Pure background — no REST/
// Connect surface.
func NewCleanupCrons(d monolithServices.Deps) *monolithServices.Module {
	repo := adminInfra.NewCleanupRepo(d.Pool)
	runner := &adminApp.CleanupRunner{
		Repo: repo,
		Log:  d.Log,
	}
	return &monolithServices.Module{
		Background: []func(ctx context.Context){
			func(ctx context.Context) {
				go runner.Run(ctx)
			},
		},
	}
}
