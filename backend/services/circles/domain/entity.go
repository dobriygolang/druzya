// Package domain — circles bounded context (bible §9 Phase 6.5.3).
//
// A Circle is a community of users sharing an interest. Events live in a
// sibling bounded context (`events`) and reference circles by id only.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Role of a circle member.
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

func (r Role) Valid() bool { return r == RoleAdmin || r == RoleMember }

// Circle is the persistent circles row.
type Circle struct {
	ID          uuid.UUID
	Name        string
	Description string
	OwnerID     uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Member is one circle_members row.
type Member struct {
	CircleID uuid.UUID
	UserID   uuid.UUID
	Role     Role
	JoinedAt time.Time
}

// MemberWithUsername — projection joined on users.username for UI chips.
type MemberWithUsername struct {
	Member
	Username string
}

// Domain errors.
var (
	ErrNotFound  = errors.New("circles: not found")
	ErrForbidden = errors.New("circles: forbidden")
	ErrConflict  = errors.New("circles: conflict")
)
