// Package domain — ML-track detection.
//
// MLProfile carries a thin «is this user on the ML track?» signal which the
// coach uses to swap default prompts (briefSystemPrompt + nextActionSystemPrompt)
// for ML-flavoured variants. Two independent signals fold into IsML:
//
//   1. user_primary_goals.kind = 'ml_offer' — F2 single-active primary goal
//      (see domain/primary_goal.go). User explicitly committed to ML offer
//      timeline via /goal flow.
//   2. hone_user_settings.active_track = 'ml' — UI-level track filter that
//      Hone Today/Plan/Reading respect. Lighter signal: user is browsing
//      ML content but hasn't committed to a primary_goal.
//
// EITHER signal triggers the ML overlay — coach behaviour должна быть
// consistent across «I'm exploring ML» (active_track) и «I committed to ML
// offer» (primary_goal). Both flip together once user fully commits.
//
// Failsafe: when the reader cannot resolve a row (no settings, no goal,
// DB-error), IsML returns false — coach falls back to default Go-senior
// prompts. This matches the «honest, not nice» rule: we don't pretend to
// know ML context when we don't.
package domain

import (
	"context"

	"github.com/google/uuid"
)

// MLProfile — narrow projection emitted by MLProfileReader. Reserved для
// future signals (preferred ML stack: pytorch vs jax vs tf; current track
// step is recsys vs LLM); сейчас single bit достаточно.
type MLProfile struct {
	IsML bool

	// PrimaryGoalIsMLOffer — true когда user_primary_goals.kind = 'ml_offer'
	// AND active=TRUE. Сильнее сигнал чем active_track (deliberate commit).
	PrimaryGoalIsMLOffer bool

	// ActiveTrackIsML — true когда hone_user_settings.active_track = 'ml'.
	// Lighter signal: UI exploration, не commit.
	ActiveTrackIsML bool
}

// MLProfileReader — narrow port. Implementation in
// services/intelligence/infra/ml_profile_repo.go reads from
// user_primary_goals + hone_user_settings в одном round-trip.
//
// Fail-soft: при любых ошибках реализация может возвращать (MLProfile{}, nil)
// — coach деградирует к default-prompt'у, not crash. Caller всегда передаёт
// non-error path и инспектирует out.IsML.
type MLProfileReader interface {
	GetMLProfile(ctx context.Context, userID uuid.UUID) (MLProfile, error)
}
