package app

import (
	sharedDomain "druz9/shared/domain"
)

// SubscribeHandlers registers every cohort subscription onto the bus. Called
// once at startup from cmd/monolith/main.go (see WIRING.md).
//
// STUB: for MVP we only subscribe to arena.MatchCompleted so the cohort can
// bump next-week seed. Future subscribers (spectator events, raid events)
// will land here too — keep the adapters in this file.
func SubscribeHandlers(bus sharedDomain.Bus, onMatch *OnMatchCompleted) {
	if bus == nil {
		return
	}
	if onMatch != nil {
		bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(), onMatch.HandleMatchCompleted)
	}
}
