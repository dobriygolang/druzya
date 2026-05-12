// Package telemetry wires the opt-in product analytics bounded context
// в монолит. Минимальная композиция: repo (pgx) + RecordEvents UC +
// Connect-RPC server + REST alias на POST /api/v1/telemetry/events.
package telemetry

import (
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	telemetryApp "druz9/telemetry/app"
	telemetryInfra "druz9/telemetry/infra"
	telemetryPorts "druz9/telemetry/ports"

	"github.com/go-chi/chi/v5"
)

// NewTelemetry wires the bounded context.
func NewTelemetry(d monolithServices.Deps) *monolithServices.Module {
	repo := telemetryInfra.NewPostgres(d.Pool)
	record := &telemetryApp.RecordEvents{
		Repo: repo,
		Now:  d.Now,
	}
	// Consent + export/delete optional — wire when client UI requires them.
	server := telemetryPorts.NewServer(record, nil, nil, nil, nil, d.Log)
	connectPath, connectHandler := druz9v1connect.NewTelemetryServiceHandler(server)
	transcoder := monolithServices.MustTranscode("telemetry", connectPath, connectHandler)
	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/telemetry/events", transcoder.ServeHTTP)
		},
	}
}
