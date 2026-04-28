// Package quiz wires the quiz service into the monolith.
//
// Stays a pure facade: every dep is constructed via the service's own
// infra constructors, and the only thing this file does is hand them to
// app.* and mount the ports.Handler at /api/v1/quiz/*.
package quiz

import (
	monolithServices "druz9/cmd/monolith/services"
	quizApp "druz9/quiz/app"
	quizInfra "druz9/quiz/infra"
	quizPorts "druz9/quiz/ports"

	"github.com/go-chi/chi/v5"
)

// NewQuiz wires the quiz module. Redis is required (sessions live there);
// when d.Redis is nil the module mounts no routes — the frontend gets a
// clean 404 on /api/v1/quiz/*.
func NewQuiz(d monolithServices.Deps) *monolithServices.Module {
	if d.Redis == nil {
		// No Redis → no quiz. Hone TaskBoard kind=quiz cards still render
		// but the deep_link target 404s gracefully.
		return &monolithServices.Module{}
	}
	pool := quizInfra.NewPostgresPool(d.Pool)
	sessions := quizInfra.NewRedisSessionStore(d.Redis)
	grader := quizInfra.NewFuzzyGrader()
	bus := quizInfra.NewBusPublisher(d.Bus)

	start := &quizApp.StartSession{
		Pool: pool, Sessions: sessions, Now: d.Now, Log: d.Log,
	}
	submit := &quizApp.SubmitSession{
		Sessions: sessions, Grader: grader, Bus: bus, Log: d.Log,
	}
	handler := &quizPorts.Handler{Start: start, Submit: submit, Log: d.Log}

	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			handler.Mount(r)
		},
	}
}
