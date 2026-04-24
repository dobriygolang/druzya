//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"

	"github.com/google/uuid"
)

// CircleRepo persists circles rows.
type CircleRepo interface {
	Create(ctx context.Context, c Circle) (Circle, error)
	Get(ctx context.Context, id uuid.UUID) (Circle, error)
	ListByMember(ctx context.Context, userID uuid.UUID) ([]Circle, error)
	Delete(ctx context.Context, id uuid.UUID) error
	CountMembers(ctx context.Context, circleID uuid.UUID) (int, error)
}

// MemberRepo persists circle_members rows.
type MemberRepo interface {
	Add(ctx context.Context, m Member) (Member, error)
	Remove(ctx context.Context, circleID, userID uuid.UUID) error
	GetRole(ctx context.Context, circleID, userID uuid.UUID) (Role, error)
	List(ctx context.Context, circleID uuid.UUID) ([]MemberWithUsername, error)
}
