//go:generate mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Repo is the persistence surface for the tutor bounded context. One
// interface (not split per-aggregate) because the implementation is a
// single struct over *pgxpool.Pool — splitting would force more
// dependency wiring without a corresponding test-isolation win.
type Repo interface {
	// CreateInvite persists a new invite. The caller has already
	// generated the code and computed expires_at; this method only
	// inserts. Returns ErrInvalidInput if the code clashes with an
	// existing UNIQUE row (collision is so rare that we surface it
	// instead of retrying — caller can re-roll).
	CreateInvite(ctx context.Context, inv Invite) (Invite, error)

	// GetInviteByCode returns the most recent invite for a code,
	// regardless of state (active / accepted / revoked / expired).
	// Used by /invite/{code} landing — the handler decides what to
	// render based on the status.
	GetInviteByCode(ctx context.Context, code string) (Invite, error)

	// ListTutorInvites returns this tutor's invites, most-recent
	// first. limit caps the result; pass 0 for «all (admin only)».
	ListTutorInvites(ctx context.Context, tutorID uuid.UUID, limit int) ([]Invite, error)

	// RevokeInvite stamps revoked_at on an active invite. ErrNotFound
	// if the invite doesn't exist; ErrInviteAccepted /
	// ErrInviteRevoked if it's already in a terminal state.
	RevokeInvite(ctx context.Context, tutorID, inviteID uuid.UUID, now time.Time) error

	// AcceptInvite atomically (within one transaction):
	//   1. validates the invite is still Active at `now`,
	//   2. stamps accepted_at + accepted_by,
	//   3. inserts a tutor_students row (or no-ops if an active
	//      relationship already exists — ErrAlreadyEnrolled).
	// Returns the resulting Relationship.
	AcceptInvite(ctx context.Context, code string, studentID uuid.UUID, now time.Time) (Relationship, error)

	// ListTutorStudents returns active relationships for a tutor.
	// Soft-ended rows are excluded — UI surfaces them via a separate
	// «archived» tab if/when needed.
	ListTutorStudents(ctx context.Context, tutorID uuid.UUID) ([]Relationship, error)

	// EndRelationship soft-ends the relationship. Used by tutor («I'm
	// no longer working with this student») or by admin moderation.
	EndRelationship(ctx context.Context, tutorID, studentID uuid.UUID, now time.Time) error
}
