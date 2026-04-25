// Package app — events use cases. Authorisation flows through CircleAuthority,
// keeping events-domain independent of circles-domain.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/events/domain"

	"github.com/google/uuid"
)

type Handlers struct {
	Events       domain.EventRepo
	Participants domain.ParticipantRepo
	Circles      domain.CircleAuthority
	Now          func() time.Time
}

func NewHandlers(events domain.EventRepo, parts domain.ParticipantRepo, circles domain.CircleAuthority) *Handlers {
	return &Handlers{Events: events, Participants: parts, Circles: circles, Now: time.Now}
}

// EventDetails — read projection used by Get / Create / Join.
type EventDetails struct {
	Event        domain.EventWithCircleName
	Participants []domain.ParticipantWithUsername
}

func (h *Handlers) CreateEvent(ctx context.Context, callerID uuid.UUID, in domain.Event) (EventDetails, error) {
	if strings.TrimSpace(in.Title) == "" {
		return EventDetails{}, fmt.Errorf("title: %w", domain.ErrConflict)
	}
	if !in.Recurrence.Valid() {
		in.Recurrence = domain.RecurrenceNone
	}
	// Authority gate — only circle admins create events.
	ok, err := h.Circles.IsAdmin(ctx, in.CircleID, callerID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("circles.IsAdmin: %w", err)
	}
	if !ok {
		return EventDetails{}, domain.ErrForbidden
	}
	now := h.Now().UTC()
	in.ID = uuid.New()
	in.CreatedBy = callerID
	in.CreatedAt = now
	saved, err := h.Events.Create(ctx, in)
	if err != nil {
		return EventDetails{}, fmt.Errorf("events.Create: %w", err)
	}
	if _, addErr := h.Participants.Add(ctx, domain.Participant{
		EventID: saved.ID, UserID: callerID, JoinedAt: now,
	}); addErr != nil {
		return EventDetails{}, fmt.Errorf("participants.Add creator: %w", addErr)
	}
	full, err := h.Events.Get(ctx, saved.ID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("events.Get: %w", err)
	}
	parts, err := h.Participants.List(ctx, saved.ID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("participants.List: %w", err)
	}
	return EventDetails{Event: full, Participants: parts}, nil
}

func (h *Handlers) GetEvent(ctx context.Context, eventID, callerID uuid.UUID) (EventDetails, error) {
	full, err := h.Events.Get(ctx, eventID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("events.Get: %w", err)
	}
	ok, err := h.Circles.IsMember(ctx, full.CircleID, callerID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("circles.IsMember: %w", err)
	}
	if !ok {
		return EventDetails{}, domain.ErrForbidden
	}
	parts, err := h.Participants.List(ctx, eventID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("participants.List: %w", err)
	}
	return EventDetails{Event: full, Participants: parts}, nil
}

func (h *Handlers) ListMyEvents(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]domain.EventWithCircleName, error) {
	if from.IsZero() {
		// Default window starts 24h in the past so an event that the user
		// just created with starts_at = "now" still appears in the list
		// (the form sends a datetime-local string that round-trips through
		// UTC and tends to land slightly behind the server clock — a strict
		// `>= now()` filter dropped just-saved rows).
		from = h.Now().UTC().Add(-24 * time.Hour)
	}
	if to.IsZero() {
		// Раньше было 90 дней — юзер создавал event на 6+ месяцев вперёд
		// (запланированное собеседование, релиз, etc) и тот не попадал
		// в дефолтное окно ListMyEvents → пустой список. Расширяем до 1 года.
		// Если фронт нужно лимитировать (perf на больших списках) — пусть
		// отправляет explicit `to`.
		to = from.Add(365 * 24 * time.Hour)
	}
	out, err := h.Events.ListUpcomingByMember(ctx, userID, from, to)
	if err != nil {
		return nil, fmt.Errorf("events.ListUpcomingByMember: %w", err)
	}
	return out, nil
}

func (h *Handlers) JoinEvent(ctx context.Context, eventID, callerID uuid.UUID) (EventDetails, error) {
	full, err := h.Events.Get(ctx, eventID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("events.Get: %w", err)
	}
	ok, err := h.Circles.IsMember(ctx, full.CircleID, callerID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("circles.IsMember: %w", err)
	}
	if !ok {
		return EventDetails{}, domain.ErrForbidden
	}
	if _, addErr := h.Participants.Add(ctx, domain.Participant{
		EventID: eventID, UserID: callerID, JoinedAt: h.Now().UTC(),
	}); addErr != nil {
		return EventDetails{}, fmt.Errorf("participants.Add: %w", addErr)
	}
	parts, err := h.Participants.List(ctx, eventID)
	if err != nil {
		return EventDetails{}, fmt.Errorf("participants.List: %w", err)
	}
	return EventDetails{Event: full, Participants: parts}, nil
}

func (h *Handlers) LeaveEvent(ctx context.Context, eventID, callerID uuid.UUID) error {
	if err := h.Participants.Remove(ctx, eventID, callerID); err != nil {
		return fmt.Errorf("participants.Remove: %w", err)
	}
	return nil
}

func (h *Handlers) DeleteEvent(ctx context.Context, eventID, callerID uuid.UUID) error {
	full, err := h.Events.Get(ctx, eventID)
	if err != nil {
		return fmt.Errorf("events.Get: %w", err)
	}
	if full.CreatedBy != callerID {
		// Allow circle admins to also delete events created by others.
		isAdmin, ierr := h.Circles.IsAdmin(ctx, full.CircleID, callerID)
		if ierr != nil {
			return fmt.Errorf("circles.IsAdmin: %w", ierr)
		}
		if !isAdmin {
			return domain.ErrForbidden
		}
	}
	if err := h.Events.Delete(ctx, eventID); err != nil {
		return fmt.Errorf("events.Delete: %w", err)
	}
	return nil
}
