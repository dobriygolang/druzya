// In-process event bus + per-module subscription registration.
//
// Each domain Module declares its own Subscribers callbacks; this file
// drives them in the same order the pre-refactor main.go did so any
// ordering-sensitive consumer (e.g. profile.OnUserRegistered MUST run
// before notify's OnUserRegistered) keeps its existing semantics.
package bootstrap

import (
	"log/slog"

	"druz9/cmd/monolith/services"
	"druz9/shared/pkg/eventbus"
)

func newEventBus(log *slog.Logger) *eventbus.InProcess {
	return eventbus.NewInProcess(log)
}

func registerSubscribers(bus *eventbus.InProcess, modules []*services.Module) {
	for _, m := range modules {
		if m == nil {
			continue
		}
		for _, sub := range m.Subscribers {
			sub(bus)
		}
	}
}
