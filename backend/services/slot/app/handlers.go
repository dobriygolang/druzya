package app

import (
	sharedDomain "druz9/shared/domain"
)

// SubscribeHandlers is the hook for the monolith to register any slot-domain
// subscribers on the shared event bus. Called once at startup from
// cmd/monolith/main.go (see WIRING.md).
//
// STUB: the slot domain does not subscribe to any events today — all effects
// are outgoing (SlotBooked, SlotCancelled), handled by the notify domain.
// The function is kept as a forward-compatibility hook so future additions
// (e.g. `slot.ReminderDue` from a cron / scheduler) land here rather than in
// the monolith main.go.
func SubscribeHandlers(bus sharedDomain.Bus) {
	_ = bus
}
