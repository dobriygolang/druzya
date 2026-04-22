package services

import (
	feedApp "druz9/feed/app"
	feedPorts "druz9/feed/ports"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewFeed wires the public anonymised event stream consumed by the
// landing-page sanctum view. WS at /ws/feed is intentionally UNAUTHED —
// the subscriber strips PII before broadcasting.
func NewFeed(d Deps) *Module {
	hub := feedPorts.NewHub(d.Log)
	sub := &feedApp.Subscriber{Out: hub, Log: d.Log}

	return &Module{
		MountWS: func(ws chi.Router) { ws.Get("/feed", hub.Handle) },
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) { sub.Register(b) },
		},
	}
}
