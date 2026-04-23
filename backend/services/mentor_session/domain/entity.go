// Package domain holds mentor session booking entities.
//
// STRATEGIC SCAFFOLD: see ../README.md and docs/strategic/mentor-marketplace.md.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotImplemented is the canonical sentinel for stub use cases.
var ErrNotImplemented = errors.New("mentor_session: not implemented; see docs/strategic/mentor-marketplace.md")

// SessionStatus tracks the booking lifecycle.
type SessionStatus string

const (
	StatusRequested SessionStatus = "requested"
	StatusAccepted  SessionStatus = "accepted"
	StatusCompleted SessionStatus = "completed"
	StatusDisputed  SessionStatus = "disputed"
	StatusCancelled SessionStatus = "cancelled"
)

// EscrowState captures the money flow state.
//
// In Phase 1 this MUST stay 'disabled' for every row — the marketplace
// runs without payments, validating product-market fit first. Phase 2
// introduces Stripe Connect; only then do 'held'/'released'/'refunded'
// become reachable.
type EscrowState string

const (
	EscrowDisabled EscrowState = "disabled"
	EscrowHeld     EscrowState = "held"
	EscrowReleased EscrowState = "released"
	EscrowRefunded EscrowState = "refunded"
)

// MentorSession is one booked or proposed coaching session.
type MentorSession struct {
	ID          uuid.UUID
	MenteeID    uuid.UUID
	MentorID    uuid.UUID
	SlotAt      time.Time
	DurationMin int
	Status      SessionStatus
	EscrowState EscrowState
	PriceCents  int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// MentorCard is the directory list-row projection.
type MentorCard struct {
	UserID      uuid.UUID
	Username    string
	DisplayName string
	HourlyRate  int
	Bio         string
	Languages   []string
	Verified    bool
	OverallElo  int
}
