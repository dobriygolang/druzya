package app

import (
	sharedDomain "druz9/shared/domain"
)

// SubscribeHandlers is a placeholder for future event subscriptions on the
// podcast side. Today the domain has no inbound subscriptions — it only
// PUBLISHES (PodcastCompleted locally + XPGained via the shared bus).
//
// Kept as a symmetric hook so main.go has a single site to extend when we
// add, e.g. an OnSubscriptionExpired reaction that hides premium-only
// episodes.
func SubscribeHandlers(_ sharedDomain.Bus) {
	// intentionally empty — see package comment
}
