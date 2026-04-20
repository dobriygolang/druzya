package app

// Package-level doc pointer.
//
// ai_native currently does NOT subscribe to any cross-domain events — it only
// publishes NativeRoundFinished on Finish.Do. This file exists as a landing
// pad for future event-handler adapters (e.g. reacting to a profile update
// flipping the preferred LLM model) so the app package stays the single
// owner of all orchestration code.
//
// STUB: cross-session analytics (trap-catch rate per user, model vs. score
// correlations) will live here when the aggregator lands.
