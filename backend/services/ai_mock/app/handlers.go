package app

// Event handlers for ai_mock. The ai_mock domain does not SUBSCRIBE to any
// external event today — it only PUBLISHES MockSessionCreated and
// MockSessionFinished (see create_session.go + finish_session.go). This file
// is the stub home for future handlers (e.g. auth.UserRegistered → seed a
// welcome mock, or billing.SubscriptionActivated → unlock premium models).
//
// Kept present so the wiring checklist in WIRING.md has a stable symbol to
// reference when the first subscription is added.
