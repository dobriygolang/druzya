// auto_promote_cron.go — F6 heuristic auto-promote daemon wiring.
//
// Runs curation/app.AutoPromote on a 6h ticker. Pure-Go heuristic — no
// LLM. Symmetric with intelligence.AutoPromoteCron (LLM-validated daily
// promote): this loop maintains avg_quality + user_count refreshes from
// user_resource_log and toggles promoted_at / deprecated_at lifecycles.
//
// Idempotency: the AutoPromoteRepo SELECTs filter promoted_at IS NULL
// + deprecated_at IS NULL, so re-running on the same data is a no-op.
package curation

import (
	"context"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	curationApp "druz9/curation/app"
	curationInfra "druz9/curation/infra"
)

// AutoPromoteTickInterval — public so tests / migration scripts can
// trigger one-off runs at boot.
const AutoPromoteTickInterval = 6 * time.Hour

// NewAutoPromoteCron wires the F6 heuristic daemon. nil-pool guard
// returns an empty module so the binary still boots in tests with no
// database (legacy contract — see other crons in this directory).
func NewAutoPromoteCron(d monolithServices.Deps) *monolithServices.Module {
	if d.Pool == nil {
		d.Log.Warn("curation.auto_promote: pool nil — skip cron")
		return &monolithServices.Module{}
	}
	repo := curationInfra.NewAutoPromoteRepo(d.Pool)
	uc := &curationApp.AutoPromote{
		Reader: repo,
		Writer: repo,
		Log:    d.Log,
		Now:    d.Now,
	}

	return &monolithServices.Module{
		Background: []func(ctx context.Context){
			func(ctx context.Context) {
				// Bootstrap calls Background entries synchronously —
				// spawn a goroutine so ListenAndServe isn't blocked.
				go func() {
					// Run once at boot to catch any backlog that
					// accumulated while the binary was down.
					if _, err := uc.Run(ctx); err != nil && d.Log != nil {
						d.Log.Warn("curation.auto_promote: initial run", "err", err)
					}
					t := time.NewTicker(AutoPromoteTickInterval)
					defer t.Stop()
					for {
						select {
						case <-ctx.Done():
							return
						case <-t.C:
							if _, err := uc.Run(ctx); err != nil && d.Log != nil {
								d.Log.Warn("curation.auto_promote: tick", "err", err)
							}
						}
					}
				}()
			},
		},
	}
}
