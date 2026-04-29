// Package quiz wires the quiz service into the monolith.
//
// Stays a pure facade: every dep is constructed via the service's own infra
// constructors, the Connect server is wrapped by vanguard so the same
// implementation serves /api/v1/quiz/* (REST) and /druz9.v1.QuizService/*
// (Connect/gRPC) with one mount.
package quiz

import (
	monolithServices "druz9/cmd/monolith/services"
	quizApp "druz9/quiz/app"
	quizInfra "druz9/quiz/infra"
	quizPorts "druz9/quiz/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewQuiz wires the quiz module. Redis is required (sessions live there);
// when d.Redis is nil the module mounts no routes — the frontend gets a
// clean 404 on /api/v1/quiz/*.
func NewQuiz(d monolithServices.Deps) *monolithServices.Module {
	if d.Redis == nil {
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
	server := &quizPorts.Server{Start: start, Submit: submit, Log: d.Log}

	connectPath, connectHandler := druz9v1connect.NewQuizServiceHandler(server)
	transcoder := monolithServices.MustTranscode("quiz", connectPath, connectHandler)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// REST aliases declared in proto/druz9/v1/quiz.proto via
			// google.api.http annotations. The transcoder routes both to
			// the same Connect impl.
			r.Post("/quiz/start", transcoder.ServeHTTP)
			r.Post("/quiz/{session_id}/submit", transcoder.ServeHTTP)
		},
	}
}
