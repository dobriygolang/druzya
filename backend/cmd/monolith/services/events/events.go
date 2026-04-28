package events

import (
	"context"

	monolithServices "druz9/cmd/monolith/services"
	circlesServices "druz9/cmd/monolith/services/circles"
	eventsApp "druz9/events/app"
	eventsInfra "druz9/events/infra"
	eventsPorts "druz9/events/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewEvents wires the events bounded-context. Authority over circle
// membership flows through CirclesAuthorityAdapter so events stays
// decoupled from circles' internal types.
func NewEvents(d monolithServices.Deps, circles circlesServices.CirclesModule) *monolithServices.Module {
	events := eventsInfra.NewEvents(d.Pool)
	parts := eventsInfra.NewParticipants(d.Pool)
	ledger := eventsInfra.NewNotificationLedger(d.Pool)
	handlers := eventsApp.NewHandlers(events, parts, circlesServices.CirclesAuthorityAdapter{H: circles.Handlers})
	server := eventsPorts.NewEventsServer(handlers, d.Log)

	connectPath, connectHandler := druz9v1connect.NewEventsServiceHandler(server)
	transcoder := monolithServices.MustTranscode("events", connectPath, connectHandler)

	cleanup := &eventsApp.CleanupWorker{
		Events: events,
		Log:    d.Log,
		Now:    d.Now,
	}
	notifier := &eventsApp.StartingSoonNotifier{
		Events: events,
		Ledger: ledger,
		Bus:    d.Bus,
		Log:    d.Log,
		Now:    d.Now,
	}

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/events", transcoder.ServeHTTP)
			r.Get("/events", transcoder.ServeHTTP)
			r.Get("/events/{event_id}", transcoder.ServeHTTP)
			r.Delete("/events/{event_id}", transcoder.ServeHTTP)
			r.Post("/events/{event_id}/join", transcoder.ServeHTTP)
			r.Post("/events/{event_id}/leave", transcoder.ServeHTTP)
		},
		Background: []func(context.Context){
			func(ctx context.Context) { go cleanup.Run(ctx) },
			func(ctx context.Context) { go notifier.Run(ctx) },
		},
	}
}
