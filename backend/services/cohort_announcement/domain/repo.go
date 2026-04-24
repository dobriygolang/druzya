package domain

import (
	"context"

	"github.com/google/uuid"
)

// Repo persists announcements + their reactions.
type Repo interface {
	Create(ctx context.Context, a Announcement) (Announcement, error)
	GetByID(ctx context.Context, id uuid.UUID) (Announcement, error)
	ListByCohort(ctx context.Context, cohortID, viewerID uuid.UUID, limit int) ([]Announcement, error)
	Delete(ctx context.Context, id uuid.UUID) error

	// AddReaction inserts (announcement, user, emoji) — duplicate is a
	// no-op (ON CONFLICT DO NOTHING). Returns the freshly-counted total
	// for that emoji so the caller can echo it back to the client.
	AddReaction(ctx context.Context, announcementID, userID uuid.UUID, emoji string) (int, error)
	RemoveReaction(ctx context.Context, announcementID, userID uuid.UUID, emoji string) (int, error)
}

// MembershipLookup is the cross-service port used by app to gate reads
// (member+) and writes (coach+/owner). Lives here so app stays free of
// any direct dep on the cohort service.
type MembershipLookup interface {
	// LookupMembership returns the caller's role in a cohort, or
	// ErrNotMember when they're not in. Implementation lives in monolith
	// (services/cohort_announcement.go) and bridges to cohort.Repo.
	LookupMembership(ctx context.Context, cohortID, userID uuid.UUID) (Role, error)
}

type Role string

const (
	RoleNotMember Role = "" // sentinel — caller is not in the cohort
	RoleMember    Role = "member"
	RoleCoach     Role = "coach"
	RoleOwner     Role = "owner"
)
