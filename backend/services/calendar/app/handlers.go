// Package app — calendar use cases. Pure orchestrators around the repo.
//
// Each use case validates input, defaults are filled, then the repo call
// is delegated. Use-case-level errors wrap domain.ErrInvalidInput when
// the input is structurally bad; the port layer maps those to
// connect.CodeInvalidArgument.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/calendar/domain"

	"github.com/google/uuid"
)

// MaxTitleLen — applied at the use-case layer; the column is unbounded
// TEXT, but we don't want a 100KB title in the calendar grid.
const MaxTitleLen = 200

// CreateEventInput captures everything a fresh row needs.
type CreateEventInput struct {
	UserID           uuid.UUID
	Kind             domain.Kind
	Title            string
	Description      string
	StartsAt         time.Time
	EndsAt           *time.Time
	AllDay           bool
	CompanyID        *uuid.UUID
	Role             string
	CurrentLevel     string
	ReadinessPct     int
	CodexArticleSlug string
	TrackID          *uuid.UUID
	ClubSessionID    *uuid.UUID
	Source           domain.Source
}

// CreateEvent — manual user creation (UI form) or AI-generated suggestion.
type CreateEvent struct {
	Repo domain.Repo
}

// Do executes the use case.
func (uc *CreateEvent) Do(ctx context.Context, in CreateEventInput) (domain.Event, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.Event{}, fmt.Errorf("calendar.CreateEvent: %w: empty title", domain.ErrInvalidInput)
	}
	if len(title) > MaxTitleLen {
		title = title[:MaxTitleLen]
	}
	if !in.Kind.IsValid() {
		return domain.Event{}, fmt.Errorf("calendar.CreateEvent: %w: invalid kind %q", domain.ErrInvalidInput, in.Kind)
	}
	if in.StartsAt.IsZero() {
		return domain.Event{}, fmt.Errorf("calendar.CreateEvent: %w: starts_at is required", domain.ErrInvalidInput)
	}
	if in.EndsAt != nil && in.EndsAt.Before(in.StartsAt) {
		return domain.Event{}, fmt.Errorf("calendar.CreateEvent: %w: ends_at < starts_at", domain.ErrInvalidInput)
	}
	if in.ReadinessPct < 0 || in.ReadinessPct > 100 {
		return domain.Event{}, fmt.Errorf("calendar.CreateEvent: %w: readiness_pct out of range", domain.ErrInvalidInput)
	}
	source := in.Source
	if !source.IsValid() {
		source = domain.SourceUser
	}
	e := domain.Event{
		UserID:           in.UserID,
		Kind:             in.Kind,
		Title:            title,
		Description:      in.Description,
		StartsAt:         in.StartsAt.UTC(),
		EndsAt:           normalizeEndsAt(in.EndsAt),
		AllDay:           in.AllDay,
		CompanyID:        in.CompanyID,
		Role:             in.Role,
		CurrentLevel:     in.CurrentLevel,
		ReadinessPct:     in.ReadinessPct,
		CodexArticleSlug: in.CodexArticleSlug,
		TrackID:          in.TrackID,
		ClubSessionID:    in.ClubSessionID,
		Status:           domain.StatusPlanned,
		Source:           source,
	}
	created, err := uc.Repo.Create(ctx, e)
	if err != nil {
		return domain.Event{}, fmt.Errorf("calendar.CreateEvent: %w", err)
	}
	return created, nil
}

// UpdateEventInput — full-replace shape. Status / outcome NOT here.
type UpdateEventInput struct {
	UserID           uuid.UUID
	EventID          uuid.UUID
	Kind             domain.Kind
	Title            string
	Description      string
	StartsAt         time.Time
	EndsAt           *time.Time
	AllDay           bool
	CompanyID        *uuid.UUID
	Role             string
	CurrentLevel     string
	ReadinessPct     int
	CodexArticleSlug string
	TrackID          *uuid.UUID
	ClubSessionID    *uuid.UUID
}

// UpdateEvent — full-overwrite of editable fields.
type UpdateEvent struct {
	Repo domain.Repo
}

// Do executes the use case.
func (uc *UpdateEvent) Do(ctx context.Context, in UpdateEventInput) (domain.Event, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.Event{}, fmt.Errorf("calendar.UpdateEvent: %w: empty title", domain.ErrInvalidInput)
	}
	if !in.Kind.IsValid() {
		return domain.Event{}, fmt.Errorf("calendar.UpdateEvent: %w: invalid kind %q", domain.ErrInvalidInput, in.Kind)
	}
	if in.StartsAt.IsZero() {
		return domain.Event{}, fmt.Errorf("calendar.UpdateEvent: %w: starts_at is required", domain.ErrInvalidInput)
	}
	if in.EndsAt != nil && in.EndsAt.Before(in.StartsAt) {
		return domain.Event{}, fmt.Errorf("calendar.UpdateEvent: %w: ends_at < starts_at", domain.ErrInvalidInput)
	}
	e := domain.Event{
		ID:               in.EventID,
		UserID:           in.UserID,
		Kind:             in.Kind,
		Title:            title,
		Description:      in.Description,
		StartsAt:         in.StartsAt.UTC(),
		EndsAt:           normalizeEndsAt(in.EndsAt),
		AllDay:           in.AllDay,
		CompanyID:        in.CompanyID,
		Role:             in.Role,
		CurrentLevel:     in.CurrentLevel,
		ReadinessPct:     in.ReadinessPct,
		CodexArticleSlug: in.CodexArticleSlug,
		TrackID:          in.TrackID,
		ClubSessionID:    in.ClubSessionID,
	}
	out, err := uc.Repo.Update(ctx, e)
	if err != nil {
		return domain.Event{}, fmt.Errorf("calendar.UpdateEvent: %w", err)
	}
	return out, nil
}

// DeleteEvent removes a row.
type DeleteEvent struct {
	Repo domain.Repo
}

// Do executes the use case.
func (uc *DeleteEvent) Do(ctx context.Context, userID, eventID uuid.UUID) error {
	if err := uc.Repo.Delete(ctx, userID, eventID); err != nil {
		return fmt.Errorf("calendar.DeleteEvent: %w", err)
	}
	return nil
}

// ListEvents — month/week-grid read.
type ListEvents struct {
	Repo domain.Repo
}

// ListEventsInput.
type ListEventsInput struct {
	UserID uuid.UUID
	From   time.Time
	To     time.Time
	Kinds  []domain.Kind
}

// Do executes the use case.
func (uc *ListEvents) Do(ctx context.Context, in ListEventsInput) ([]domain.EventWithCompany, error) {
	if in.To.Before(in.From) {
		return nil, fmt.Errorf("calendar.ListEvents: %w: to < from", domain.ErrInvalidInput)
	}
	rows, err := uc.Repo.ListByUser(ctx, in.UserID, in.From.UTC(), in.To.UTC(), in.Kinds)
	if err != nil {
		return nil, fmt.Errorf("calendar.ListEvents: %w", err)
	}
	return rows, nil
}

// ListUpcoming — Hone Today / Coach feed.
type ListUpcoming struct {
	Repo domain.Repo
}

// Do executes the use case.
func (uc *ListUpcoming) Do(ctx context.Context, userID uuid.UUID, withinDays int) ([]domain.EventWithCompany, error) {
	rows, err := uc.Repo.ListUpcomingForCoach(ctx, userID, withinDays)
	if err != nil {
		return nil, fmt.Errorf("calendar.ListUpcoming: %w", err)
	}
	return rows, nil
}

// SetEventStatus — terminal-state transition (cancel / mark done).
type SetEventStatus struct {
	Repo domain.Repo
}

// SetEventStatusInput.
type SetEventStatusInput struct {
	UserID  uuid.UUID
	EventID uuid.UUID
	Status  domain.Status
}

// Do executes the use case.
func (uc *SetEventStatus) Do(ctx context.Context, in SetEventStatusInput) (domain.Event, error) {
	if !in.Status.IsValid() {
		return domain.Event{}, fmt.Errorf("calendar.SetEventStatus: %w: invalid status %q", domain.ErrInvalidInput, in.Status)
	}
	out, err := uc.Repo.SetStatus(ctx, in.UserID, in.EventID, in.Status)
	if err != nil {
		return domain.Event{}, fmt.Errorf("calendar.SetEventStatus: %w", err)
	}
	return out, nil
}

// UpsertOutcome — post-event reflection.
type UpsertOutcome struct {
	Repo domain.Repo
}

// UpsertOutcomeInput.
type UpsertOutcomeInput struct {
	UserID    uuid.UUID
	EventID   uuid.UUID
	FeltScore *int // 1..5
	OutcomeMD string
}

// Do executes the use case.
func (uc *UpsertOutcome) Do(ctx context.Context, in UpsertOutcomeInput) (domain.Event, error) {
	if in.FeltScore != nil && (*in.FeltScore < 1 || *in.FeltScore > 5) {
		return domain.Event{}, fmt.Errorf("calendar.UpsertOutcome: %w: felt_score out of range", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.UpsertOutcome(ctx, in.UserID, in.EventID, in.FeltScore, in.OutcomeMD)
	if err != nil {
		return domain.Event{}, fmt.Errorf("calendar.UpsertOutcome: %w", err)
	}
	return out, nil
}

// normalizeEndsAt rounds nil/zero ends_at to a clean nil.
func normalizeEndsAt(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	if t.IsZero() {
		return nil
	}
	utc := t.UTC()
	return &utc
}
