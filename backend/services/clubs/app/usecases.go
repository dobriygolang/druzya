// Package app — clubs use cases. Pure orchestrators, no SQL / HTTP.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/clubs/domain"

	"github.com/google/uuid"
)

const (
	defaultUpcomingLimit = 10
	defaultPastLimit     = 20
	defaultPublicLimit   = 30
)

// ListPublicClubs — read для /clubs catalogue. Anonymous OK.
type ListPublicClubs struct {
	Repo domain.Repo
}

// Do executes.
func (uc *ListPublicClubs) Do(ctx context.Context, limit int) ([]domain.Club, error) {
	if uc.Repo == nil {
		return nil, fmt.Errorf("clubs.ListPublic: repo not wired: %w", domain.ErrInvalidInput)
	}
	if limit <= 0 || limit > 100 {
		limit = defaultPublicLimit
	}
	out, err := uc.Repo.ListPublic(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("clubs.ListPublic: %w", err)
	}
	return out, nil
}

// GetClub — /clubs/:slug detail page (club + sessions split by upcoming/past).
type GetClub struct {
	Repo domain.Repo
}

// Do executes.
func (uc *GetClub) Do(ctx context.Context, slug string) (domain.ClubWithSessions, error) {
	if uc.Repo == nil {
		return domain.ClubWithSessions{}, fmt.Errorf("clubs.GetClub: repo not wired: %w", domain.ErrInvalidInput)
	}
	slug = strings.TrimSpace(strings.ToLower(slug))
	if slug == "" {
		return domain.ClubWithSessions{}, fmt.Errorf("clubs.GetClub: empty slug: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.GetClubWithSessions(ctx, slug, defaultUpcomingLimit, defaultPastLimit)
	if err != nil {
		return domain.ClubWithSessions{}, fmt.Errorf("clubs.GetClub: %w", err)
	}
	return out, nil
}

// GetSession — single session view (с materials + текущим RSVP юзера).
// viewerUserID — nullable; anonymous viewer не видит свой attendee status.
type GetSession struct {
	Repo domain.Repo
}

// Do executes.
func (uc *GetSession) Do(ctx context.Context, sessionID uuid.UUID, viewerUserID *uuid.UUID) (domain.SessionWithMaterials, error) {
	if uc.Repo == nil {
		return domain.SessionWithMaterials{}, fmt.Errorf("clubs.GetSession: repo not wired: %w", domain.ErrInvalidInput)
	}
	if sessionID == uuid.Nil {
		return domain.SessionWithMaterials{}, fmt.Errorf("clubs.GetSession: zero id: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.GetSessionWithMaterials(ctx, sessionID, viewerUserID)
	if err != nil {
		return domain.SessionWithMaterials{}, fmt.Errorf("clubs.GetSession: %w", err)
	}
	return out, nil
}

// CreateClub — curator-only. Caller (handler) уже проверил role=admin.
// Validation: slug ≠ "" и lowercase, name ≠ "", circle_id ≠ Nil.
type CreateClub struct {
	Repo domain.Repo
}

// Do executes.
func (uc *CreateClub) Do(ctx context.Context, in domain.CreateClubInput) (domain.Club, error) {
	if uc.Repo == nil {
		return domain.Club{}, fmt.Errorf("clubs.CreateClub: repo not wired: %w", domain.ErrInvalidInput)
	}
	in.Slug = strings.TrimSpace(strings.ToLower(in.Slug))
	in.Name = strings.TrimSpace(in.Name)
	if in.Slug == "" || in.Name == "" || in.CircleID == uuid.Nil {
		return domain.Club{}, fmt.Errorf("clubs.CreateClub: missing required fields: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.CreateClub(ctx, in)
	if err != nil {
		return domain.Club{}, fmt.Errorf("clubs.CreateClub: %w", err)
	}
	return out, nil
}

// CreateSession — curator-only. Caller проверил role=admin или curator
// match (handler делает оба варианта). Минимальная валидация — не пускаем
// прошлогоднюю сессию (scheduled_at < now() - 24h).
type CreateSession struct {
	Repo domain.Repo
	Now  func() time.Time
}

// Do executes.
func (uc *CreateSession) Do(ctx context.Context, in domain.CreateSessionInput) (domain.Session, error) {
	if uc.Repo == nil {
		return domain.Session{}, fmt.Errorf("clubs.CreateSession: repo not wired: %w", domain.ErrInvalidInput)
	}
	in.TopicTitle = strings.TrimSpace(in.TopicTitle)
	if in.ClubID == uuid.Nil || in.TopicTitle == "" || in.ScheduledAt.IsZero() {
		return domain.Session{}, fmt.Errorf("clubs.CreateSession: missing required fields: %w", domain.ErrInvalidInput)
	}
	if uc.Now != nil {
		if in.ScheduledAt.Before(uc.Now().Add(-24 * time.Hour)) {
			return domain.Session{}, fmt.Errorf("clubs.CreateSession: scheduled_at >24h in past: %w", domain.ErrInvalidInput)
		}
	}
	if in.DurationMin <= 0 || in.DurationMin > 360 {
		in.DurationMin = 60
	}
	out, err := uc.Repo.CreateSession(ctx, in)
	if err != nil {
		return domain.Session{}, fmt.Errorf("clubs.CreateSession: %w", err)
	}
	return out, nil
}

// NextUpcomingForUser — Hone Today chip read.
type NextUpcomingForUser struct {
	Repo domain.Repo
}

// Do executes.
func (uc *NextUpcomingForUser) Do(ctx context.Context, userID uuid.UUID) (*domain.UpcomingForUser, error) {
	if uc.Repo == nil {
		return nil, fmt.Errorf("clubs.NextUpcomingForUser: repo not wired: %w", domain.ErrInvalidInput)
	}
	if userID == uuid.Nil {
		return nil, fmt.Errorf("clubs.NextUpcomingForUser: zero user: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.NextUpcomingForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("clubs.NextUpcomingForUser: %w", err)
	}
	return out, nil
}

// RSVP — upsert текущего юзера на session. Caller передаёт желаемый
// status (rsvp_yes/no). Idempotent.
type RSVP struct {
	Repo domain.Repo
}

// RSVPInput.
type RSVPInput struct {
	SessionID uuid.UUID
	UserID    uuid.UUID
	Status    domain.AttendeeStatus
}

// Do executes.
func (uc *RSVP) Do(ctx context.Context, in RSVPInput) (domain.Attendee, error) {
	if uc.Repo == nil {
		return domain.Attendee{}, fmt.Errorf("clubs.RSVP: repo not wired: %w", domain.ErrInvalidInput)
	}
	if in.SessionID == uuid.Nil || in.UserID == uuid.Nil {
		return domain.Attendee{}, fmt.Errorf("clubs.RSVP: zero id: %w", domain.ErrInvalidInput)
	}
	if !in.Status.IsValid() {
		return domain.Attendee{}, fmt.Errorf("clubs.RSVP: invalid status %q: %w", in.Status, domain.ErrInvalidInput)
	}
	out, err := uc.Repo.RSVP(ctx, in.SessionID, in.UserID, in.Status)
	if err != nil {
		return domain.Attendee{}, fmt.Errorf("clubs.RSVP: %w", err)
	}
	return out, nil
}
