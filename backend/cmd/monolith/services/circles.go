package services

import (
	"context"
	"fmt"

	circlesApp "druz9/circles/app"
	circlesInfra "druz9/circles/infra"
	circlesPorts "druz9/circles/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// circlesAuthorityAdapter satisfies events/domain.CircleAuthority. Lives
// here so the events package never imports circles directly — both
// bounded contexts stay independent.
type CirclesAuthorityAdapter struct{ H *circlesApp.Handlers }

func (a CirclesAuthorityAdapter) IsAdmin(ctx context.Context, circleID, userID uuid.UUID) (bool, error) {
	ok, err := a.H.IsAdmin(ctx, circleID, userID)
	if err != nil {
		return false, fmt.Errorf("circles.IsAdmin: %w", err)
	}
	return ok, nil
}

func (a CirclesAuthorityAdapter) IsMember(ctx context.Context, circleID, userID uuid.UUID) (bool, error) {
	ok, err := a.H.IsMember(ctx, circleID, userID)
	if err != nil {
		return false, fmt.Errorf("circles.IsMember: %w", err)
	}
	return ok, nil
}

// NewCircles wires the circles bounded-context. The handlers struct is
// also exposed via Module.Extra so the events module can reach into
// IsAdmin / IsMember without re-instantiating the repos.
type CirclesModule struct {
	*Module
	Handlers *circlesApp.Handlers
}

func NewCircles(d Deps) CirclesModule {
	circles := circlesInfra.NewCircles(d.Pool)
	members := circlesInfra.NewMembers(d.Pool)
	handlers := circlesApp.NewHandlers(circles, members)
	server := circlesPorts.NewCirclesServer(handlers, d.Log)

	connectPath, connectHandler := druz9v1connect.NewCirclesServiceHandler(server)
	transcoder := mustTranscode("circles", connectPath, connectHandler)

	return CirclesModule{
		Module: &Module{
			ConnectPath:        connectPath,
			ConnectHandler:     transcoder,
			RequireConnectAuth: true,
			MountREST: func(r chi.Router) {
				r.Post("/circles", transcoder.ServeHTTP)
				r.Get("/circles", transcoder.ServeHTTP)
				r.Get("/circles/{circle_id}", transcoder.ServeHTTP)
				r.Delete("/circles/{circle_id}", transcoder.ServeHTTP)
				r.Post("/circles/{circle_id}/join", transcoder.ServeHTTP)
				r.Post("/circles/{circle_id}/leave", transcoder.ServeHTTP)
			},
		},
		Handlers: handlers,
	}
}
