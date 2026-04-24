// Package domain holds cohort entities and ports.
//
// STRATEGIC SCAFFOLD: see ../README.md and docs/strategic/cohorts.md.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotImplemented is kept as a sentinel so existing strategic-scaffold
// tests still compile while new use-cases land. Prefer ErrNotFound /
// ErrAlreadyMember / ErrCohortFull (see repo.go) for real flows.
var ErrNotImplemented = errors.New("cohort: not implemented; see docs/strategic/cohorts.md")

// MaxMembersPhase1 — Phase 1 soft cap. См. docs/strategic/cohorts.md.
const MaxMembersPhase1 = 50

// Status represents the cohort lifecycle state.
type Status string

const (
	StatusActive    Status = "active"
	StatusGraduated Status = "graduated"
	StatusCancelled Status = "cancelled"
)

// Visibility controls who can see / discover the cohort.
type Visibility string

const (
	VisibilityInvite Visibility = "invite"
	VisibilityPublic Visibility = "public"
)

// Role of a member inside a cohort.
type Role string

const (
	RoleMember Role = "member"
	RoleCoach  Role = "coach"
	RoleOwner  Role = "owner"
)

// Cohort is the time-boxed group entity.
type Cohort struct {
	ID         uuid.UUID
	Slug       string
	Name       string
	OwnerID    uuid.UUID
	StartsAt   time.Time
	EndsAt     time.Time
	Status     Status
	Visibility Visibility
	CreatedAt  time.Time
}

// CohortPatch is the editable subset of a Cohort row. nil = leave unchanged.
type CohortPatch struct {
	Name       *string
	EndsAt     *time.Time
	Visibility *Visibility
	Status     *Status
}

// CohortMember binds a user to a cohort.
//
// Username/DisplayName/AvatarURL are denormalised — populated by ListMembers
// via JOIN with users. Single-row HasMember/AddMember reads leave them
// empty (callers don't need the projection for those paths).
type CohortMember struct {
	CohortID    uuid.UUID
	UserID      uuid.UUID
	Role        Role
	JoinedAt    time.Time
	LeftAt      *time.Time
	Username    string
	DisplayName string
	AvatarURL   string
}

// CohortInvite is a multi-use, time-bounded invite token.
type CohortInvite struct {
	Token     string
	CohortID  uuid.UUID
	CreatedBy uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
	MaxUses   int
	UsedCount int
}

// MemberStanding is a leaderboard row.
type MemberStanding struct {
	UserID      uuid.UUID
	DisplayName string
	WeeklyXP    int64
	OverallElo  int
}
