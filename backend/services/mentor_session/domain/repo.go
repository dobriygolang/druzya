package domain

import (
	"context"

	"github.com/google/uuid"
)

// SessionRepo is the persistence port for booked mentor sessions.
//
// STRATEGIC SCAFFOLD: implementation lands in `infra/postgres.go` against
// `mentor_sessions` rows from migration 00028_mentor_profile.sql.
type SessionRepo interface {
	Create(ctx context.Context, s MentorSession) (uuid.UUID, error)
	Get(ctx context.Context, id uuid.UUID) (MentorSession, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status SessionStatus) error
	ListForMentor(ctx context.Context, mentorID uuid.UUID, limit int) ([]MentorSession, error)
	ListForMentee(ctx context.Context, menteeID uuid.UUID, limit int) ([]MentorSession, error)
}

// DirectoryRepo is the read port for /mentors directory listings.
type DirectoryRepo interface {
	ListMentors(ctx context.Context, language string, limit int) ([]MentorCard, error)
	GetMentor(ctx context.Context, userID uuid.UUID) (MentorCard, error)
}
