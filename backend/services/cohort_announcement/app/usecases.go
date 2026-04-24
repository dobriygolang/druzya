// Package app — cohort announcement use cases. Orchestrates membership
// checks (via MembershipLookup port) + repo writes; no transport types.
package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"druz9/cohort_announcement/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// CohortAnnouncementPosted — published when a fresh announcement is created
// so notify-service can fan-out to every cohort member.
type cohortAnnouncementPosted struct {
	cohortID    uuid.UUID
	authorID    uuid.UUID
	announceID  uuid.UUID
	bodyPreview string
}

// CreateAnnouncement — owner/coach only.
type CreateAnnouncement struct {
	Repo       domain.Repo
	Membership domain.MembershipLookup
	Bus        sharedDomain.Bus
}

type CreateAnnouncementInput struct {
	CohortID uuid.UUID
	AuthorID uuid.UUID
	Body     string
	Pinned   bool
}

func (uc *CreateAnnouncement) Do(ctx context.Context, in CreateAnnouncementInput) (domain.Announcement, error) {
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return domain.Announcement{}, fmt.Errorf("create: %w", domain.ErrEmptyBody)
	}
	role, err := uc.Membership.LookupMembership(ctx, in.CohortID, in.AuthorID)
	if err != nil {
		return domain.Announcement{}, fmt.Errorf("create: lookup membership: %w", err)
	}
	if role != domain.RoleCoach && role != domain.RoleOwner {
		return domain.Announcement{}, fmt.Errorf("create: not coach or owner: %w", domain.ErrForbidden)
	}
	out, err := uc.Repo.Create(ctx, domain.Announcement{
		CohortID: in.CohortID,
		AuthorID: in.AuthorID,
		Body:     body,
		Pinned:   in.Pinned,
	})
	if err != nil {
		return domain.Announcement{}, fmt.Errorf("create: %w", err)
	}
	// Refetch to get author username denorm.
	full, err := uc.Repo.GetByID(ctx, out.ID)
	if err != nil {
		// Don't fail the create on hydration miss — return the bare row.
		return out, nil //nolint:nilerr
	}
	// Best-effort event publish for the notify-service fan-out.
	if uc.Bus != nil {
		_ = uc.Bus.Publish(ctx, sharedDomain.CohortAnnouncementPosted{
			CohortID:       out.CohortID,
			AuthorID:       out.AuthorID,
			AnnouncementID: out.ID,
			BodyPreview:    truncatePreview(out.Body, 140),
		})
		_ = cohortAnnouncementPosted{} // silence unused-warning if helper expands later
	}
	return full, nil
}

// ListByCohort — member+ only.
type ListByCohort struct {
	Repo       domain.Repo
	Membership domain.MembershipLookup
}

type ListByCohortInput struct {
	CohortID uuid.UUID
	ViewerID uuid.UUID
	Limit    int
}

func (uc *ListByCohort) Do(ctx context.Context, in ListByCohortInput) ([]domain.Announcement, error) {
	role, err := uc.Membership.LookupMembership(ctx, in.CohortID, in.ViewerID)
	if err != nil {
		return nil, fmt.Errorf("list: lookup membership: %w", err)
	}
	if role == domain.RoleNotMember {
		return nil, fmt.Errorf("list: %w", domain.ErrForbidden)
	}
	out, err := uc.Repo.ListByCohort(ctx, in.CohortID, in.ViewerID, in.Limit)
	if err != nil {
		return nil, fmt.Errorf("list: %w", err)
	}
	return out, nil
}

// DeleteAnnouncement — author OR owner.
type DeleteAnnouncement struct {
	Repo       domain.Repo
	Membership domain.MembershipLookup
}

func (uc *DeleteAnnouncement) Do(ctx context.Context, announcementID, userID uuid.UUID) error {
	a, err := uc.Repo.GetByID(ctx, announcementID)
	if err != nil {
		return fmt.Errorf("delete: load: %w", err)
	}
	if a.AuthorID != userID {
		role, err := uc.Membership.LookupMembership(ctx, a.CohortID, userID)
		if err != nil {
			return fmt.Errorf("delete: lookup membership: %w", err)
		}
		if role != domain.RoleOwner {
			return fmt.Errorf("delete: %w", domain.ErrForbidden)
		}
	}
	if err := uc.Repo.Delete(ctx, announcementID); err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	return nil
}

// AddReaction / RemoveReaction — member+.
type AddReaction struct {
	Repo       domain.Repo
	Membership domain.MembershipLookup
}

func (uc *AddReaction) Do(ctx context.Context, announcementID, userID uuid.UUID, emoji string) (int, error) {
	if !domain.IsAllowedEmoji(emoji) {
		return 0, fmt.Errorf("react: %w", domain.ErrInvalidEmoji)
	}
	a, err := uc.Repo.GetByID(ctx, announcementID)
	if err != nil {
		return 0, fmt.Errorf("react: load: %w", err)
	}
	role, err := uc.Membership.LookupMembership(ctx, a.CohortID, userID)
	if err != nil {
		return 0, fmt.Errorf("react: lookup membership: %w", err)
	}
	if role == domain.RoleNotMember {
		return 0, fmt.Errorf("react: %w", domain.ErrForbidden)
	}
	n, err := uc.Repo.AddReaction(ctx, announcementID, userID, emoji)
	if err != nil {
		return 0, fmt.Errorf("react: %w", err)
	}
	return n, nil
}

type RemoveReaction struct {
	Repo       domain.Repo
	Membership domain.MembershipLookup
}

func (uc *RemoveReaction) Do(ctx context.Context, announcementID, userID uuid.UUID, emoji string) (int, error) {
	if !domain.IsAllowedEmoji(emoji) {
		return 0, fmt.Errorf("unreact: %w", domain.ErrInvalidEmoji)
	}
	a, err := uc.Repo.GetByID(ctx, announcementID)
	if err != nil {
		// Removing a non-existent reaction is a no-op — treat missing
		// announcement as forbidden (don't leak existence).
		if errors.Is(err, domain.ErrNotFound) {
			return 0, fmt.Errorf("unreact: %w", domain.ErrForbidden)
		}
		return 0, fmt.Errorf("unreact: load: %w", err)
	}
	role, err := uc.Membership.LookupMembership(ctx, a.CohortID, userID)
	if err != nil {
		return 0, fmt.Errorf("unreact: lookup membership: %w", err)
	}
	if role == domain.RoleNotMember {
		return 0, fmt.Errorf("unreact: %w", domain.ErrForbidden)
	}
	n, err := uc.Repo.RemoveReaction(ctx, announcementID, userID, emoji)
	if err != nil {
		return 0, fmt.Errorf("unreact: %w", err)
	}
	return n, nil
}

func truncatePreview(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
