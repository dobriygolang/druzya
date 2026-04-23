// Package domain holds the strategic-scaffold types for the B2B HR-tech
// bounded context. See ../README.md and docs/strategic/b2b-hrtech.md.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotImplemented is the canonical sentinel returned by every stub use
// case in this bounded context. Callers MUST distinguish this from a true
// "not found" — it signals that the feature is scaffolded but not yet
// shipped. Anti-fallback policy: no method should swallow this.
var ErrNotImplemented = errors.New("orgs: not implemented; see docs/strategic/b2b-hrtech.md")

// Plan enumerates billing tiers. Validated at the DB layer too.
type Plan string

const (
	PlanTrial      Plan = "trial"
	PlanTeam       Plan = "team"
	PlanGrowth     Plan = "growth"
	PlanEnterprise Plan = "enterprise"
)

// Role captures the permission level of an org member.
type Role string

const (
	RoleMember Role = "member"
	RoleAdmin  Role = "admin"
	RoleOwner  Role = "owner"
)

// SeatStatus tracks the lifecycle of a purchased seat.
type SeatStatus string

const (
	SeatPending SeatStatus = "pending"
	SeatActive  SeatStatus = "active"
	SeatRevoked SeatStatus = "revoked"
)

// Organization is the B2B tenant entity.
type Organization struct {
	ID          uuid.UUID
	Name        string
	Slug        string
	OwnerUserID uuid.UUID
	Plan        Plan
	SeatQuota   int
	CreatedAt   time.Time
}

// OrgMember binds a user to an organisation with a role.
type OrgMember struct {
	OrgID    uuid.UUID
	UserID   uuid.UUID
	Role     Role
	JoinedAt time.Time
}

// OrgSeat represents one purchased licence inside an organisation.
//
// AssignedUserID is nil while the seat is in 'pending' status — i.e. the
// invite email has not yet matched a registered druz9 user. Anti-fallback:
// we never auto-create a placeholder user to satisfy the FK; the seat just
// stays pending forever until a real user signs up with the invite email.
type OrgSeat struct {
	ID             uuid.UUID
	OrgID          uuid.UUID
	InviteEmail    string
	AssignedUserID *uuid.UUID
	Status         SeatStatus
	AssignedAt     *time.Time
	RevokedAt      *time.Time
	CreatedAt      time.Time
}

// MemberStanding is the per-member row in the dashboard snapshot.
type MemberStanding struct {
	UserID       uuid.UUID
	DisplayName  string
	WeeklyXP     int64
	OverallElo   int
	LastActiveAt *time.Time
}

// DashboardSnapshot is the read model returned by GetDashboard.
type DashboardSnapshot struct {
	OrgID      uuid.UUID
	WeekISO    string
	Members    []MemberStanding
	SeatsUsed  int
	SeatsQuota int
}
