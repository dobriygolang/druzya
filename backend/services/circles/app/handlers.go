// Package app — use cases for circles. Thin orchestrators over domain
// repos; mirrors whiteboard_rooms / podcast layout.
package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/circles/domain"

	"github.com/google/uuid"
)

type Handlers struct {
	Circles domain.CircleRepo
	Members domain.MemberRepo
	Now     func() time.Time
}

func NewHandlers(circles domain.CircleRepo, members domain.MemberRepo) *Handlers {
	return &Handlers{Circles: circles, Members: members, Now: time.Now}
}

// CircleWithMembers carries the read-projection used by Get / Create.
type CircleWithMembers struct {
	Circle      domain.Circle
	Members     []domain.MemberWithUsername
	MemberCount int
}

func (h *Handlers) CreateCircle(ctx context.Context, ownerID uuid.UUID, name, description string) (CircleWithMembers, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return CircleWithMembers{}, fmt.Errorf("name: %w", domain.ErrConflict)
	}
	now := h.Now().UTC()
	c, err := h.Circles.Create(ctx, domain.Circle{
		ID:          uuid.New(),
		Name:        name,
		Description: description,
		OwnerID:     ownerID,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	if err != nil {
		return CircleWithMembers{}, fmt.Errorf("circles.Create: %w", err)
	}
	if _, addErr := h.Members.Add(ctx, domain.Member{
		CircleID: c.ID, UserID: ownerID, Role: domain.RoleAdmin, JoinedAt: now,
	}); addErr != nil {
		return CircleWithMembers{}, fmt.Errorf("members.Add owner: %w", addErr)
	}
	members, err := h.Members.List(ctx, c.ID)
	if err != nil {
		return CircleWithMembers{}, fmt.Errorf("members.List: %w", err)
	}
	return CircleWithMembers{Circle: c, Members: members, MemberCount: len(members)}, nil
}

func (h *Handlers) GetCircle(ctx context.Context, circleID, callerID uuid.UUID) (CircleWithMembers, error) {
	c, err := h.Circles.Get(ctx, circleID)
	if err != nil {
		return CircleWithMembers{}, fmt.Errorf("circles.Get: %w", err)
	}
	// Auto-join — same UX rule as whiteboard_rooms: GET-by-id is the invite.
	if _, roleErr := h.Members.GetRole(ctx, circleID, callerID); errors.Is(roleErr, domain.ErrNotFound) {
		if _, addErr := h.Members.Add(ctx, domain.Member{
			CircleID: circleID, UserID: callerID, Role: domain.RoleMember, JoinedAt: h.Now().UTC(),
		}); addErr != nil {
			return CircleWithMembers{}, fmt.Errorf("members.Add auto-join: %w", addErr)
		}
	} else if roleErr != nil {
		return CircleWithMembers{}, fmt.Errorf("members.GetRole: %w", roleErr)
	}
	members, err := h.Members.List(ctx, circleID)
	if err != nil {
		return CircleWithMembers{}, fmt.Errorf("members.List: %w", err)
	}
	return CircleWithMembers{Circle: c, Members: members, MemberCount: len(members)}, nil
}

func (h *Handlers) ListMyCircles(ctx context.Context, userID uuid.UUID) ([]domain.Circle, error) {
	out, err := h.Circles.ListByMember(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("circles.ListByMember: %w", err)
	}
	return out, nil
}

func (h *Handlers) JoinCircle(ctx context.Context, circleID, userID uuid.UUID) error {
	if _, err := h.Circles.Get(ctx, circleID); err != nil {
		return fmt.Errorf("circles.Get: %w", err)
	}
	if _, err := h.Members.Add(ctx, domain.Member{
		CircleID: circleID, UserID: userID, Role: domain.RoleMember, JoinedAt: h.Now().UTC(),
	}); err != nil {
		return fmt.Errorf("members.Add: %w", err)
	}
	return nil
}

func (h *Handlers) LeaveCircle(ctx context.Context, circleID, userID uuid.UUID) error {
	c, err := h.Circles.Get(ctx, circleID)
	if err != nil {
		return fmt.Errorf("circles.Get: %w", err)
	}
	if c.OwnerID == userID {
		// Owner must Delete the circle, not Leave; otherwise the circle
		// would be orphaned and the next admin lookup would race.
		return fmt.Errorf("owner cannot leave: %w", domain.ErrForbidden)
	}
	if err := h.Members.Remove(ctx, circleID, userID); err != nil {
		return fmt.Errorf("members.Remove: %w", err)
	}
	return nil
}

func (h *Handlers) DeleteCircle(ctx context.Context, circleID, callerID uuid.UUID) error {
	c, err := h.Circles.Get(ctx, circleID)
	if err != nil {
		return fmt.Errorf("circles.Get: %w", err)
	}
	if c.OwnerID != callerID {
		return domain.ErrForbidden
	}
	if err := h.Circles.Delete(ctx, circleID); err != nil {
		return fmt.Errorf("circles.Delete: %w", err)
	}
	return nil
}

// IsAdmin is a narrow helper for cross-context checks (events service
// uses this when authorising CreateEvent).
func (h *Handlers) IsAdmin(ctx context.Context, circleID, userID uuid.UUID) (bool, error) {
	role, err := h.Members.GetRole(ctx, circleID, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("members.GetRole: %w", err)
	}
	return role == domain.RoleAdmin, nil
}

// IsMember reports membership without role.
func (h *Handlers) IsMember(ctx context.Context, circleID, userID uuid.UUID) (bool, error) {
	_, err := h.Members.GetRole(ctx, circleID, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("members.GetRole: %w", err)
	}
	return true, nil
}
