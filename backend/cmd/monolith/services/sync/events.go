// SSE wiring. Owns only the constructor that mounts
// /sync/events. The Broker type itself lives in broker.go (same package).
//
// Why broker stays in monolith (not in druz9/sync module): it's a
// transport-level in-process infra component, not domain. Hone domain
// depends on it through the narrow honeDomain.SyncEventPublisher
// interface, which Broker satisfies structurally.
package sync

import (
	monolithServices "druz9/cmd/monolith/services"

	"github.com/go-chi/chi/v5"
)

// NewSyncEvents wires the SSE module. Returns Module + the broker (which
// is injected into other modules through Deps.SyncEventBroker for the
// publish side).
func NewSyncEvents(d monolithServices.Deps) (*monolithServices.Module, *Broker) {
	broker := NewBroker(d.Log)
	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			r.Get("/sync/events", broker.SSEHandler)
		},
	}, broker
}
