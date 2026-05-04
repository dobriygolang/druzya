// Package domain holds tutor entities and contracts (Wave 2 of
// docs/feature/tutor.md). Tutor is a distribution-channel persona, not
// a separate role on `users.role`. The domain only knows two concepts:
// invites (one-time tokens a tutor hands to a candidate) and
// relationships (an active tutor↔student pairing).
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Invite mirrors a row in tutor_invites. State is encoded as
// (AcceptedAt, RevokedAt) — exactly one is non-zero on a terminal
// invite; both nil means «open and within TTL».
type Invite struct {
	ID         uuid.UUID
	TutorID    uuid.UUID
	Code       string
	Note       string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	AcceptedBy *uuid.UUID
	AcceptedAt *time.Time
	RevokedAt  *time.Time
	// TargetUserID — pre-bound юзер: тутор пригласил кого-то конкретного
	// по @username. nil = классический «открытый» invite по коду. См
	// migration 00041.
	TargetUserID *uuid.UUID
}

// IsActive reports whether the invite can still be redeemed.
func (i Invite) IsActive(now time.Time) bool {
	return i.AcceptedAt == nil && i.RevokedAt == nil && now.Before(i.ExpiresAt)
}

// Status is a derived view used by handlers to render the right
// chip/badge. Computed from AcceptedAt/RevokedAt/ExpiresAt without a
// stored column — the timestamps are the source of truth and a
// computed status guarantees they can't drift.
type InviteStatus string

const (
	InviteStatusActive   InviteStatus = "active"
	InviteStatusAccepted InviteStatus = "accepted"
	InviteStatusRevoked  InviteStatus = "revoked"
	InviteStatusExpired  InviteStatus = "expired"
)

func (i Invite) Status(now time.Time) InviteStatus {
	if i.AcceptedAt != nil {
		return InviteStatusAccepted
	}
	if i.RevokedAt != nil {
		return InviteStatusRevoked
	}
	if now.After(i.ExpiresAt) {
		return InviteStatusExpired
	}
	return InviteStatusActive
}

// Relationship mirrors a row in tutor_students. EndedAt non-nil =
// soft-ended; the row is preserved for cohort analytics.
type Relationship struct {
	ID        uuid.UUID
	TutorID   uuid.UUID
	StudentID uuid.UUID
	InviteID  *uuid.UUID
	StartedAt time.Time
	EndedAt   *time.Time
	Note      string
}

// IsActive reports whether the relationship is current.
func (r Relationship) IsActive() bool { return r.EndedAt == nil }

// Defaults — kept here so app+infra share one source of truth.
const (
	// DefaultInviteTTL is 30 days from creation. Long enough that a
	// student can sit on the email for a couple of weeks without
	// pestering the tutor for a re-issue, short enough that stale
	// invites don't accumulate forever.
	DefaultInviteTTL = 30 * 24 * time.Hour

	// InviteCodeLength — 8 base32-ish chars (~40 bits). Collision-free
	// in expectation up to ~32k active invites; beyond that we'd grow
	// the code, not deal with retries.
	InviteCodeLength = 8
)
