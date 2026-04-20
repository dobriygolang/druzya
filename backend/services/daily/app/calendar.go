package app

import (
	"context"
	"fmt"
	"time"

	"druz9/daily/domain"

	"github.com/google/uuid"
)

// GetCalendar implements GET /daily/calendar.
type GetCalendar struct {
	Cal domain.CalendarRepo
	Now func() time.Time
}

// Do returns the active calendar, ErrNotFound if none.
func (uc *GetCalendar) Do(ctx context.Context, userID uuid.UUID) (domain.InterviewCalendar, error) {
	now := uc.Now().UTC()
	c, err := uc.Cal.GetActive(ctx, userID, now.Truncate(24*time.Hour))
	if err != nil {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.GetCalendar: %w", err)
	}
	c.DaysLeft = domain.DaysLeft(c.InterviewDate, now)
	// STUB: readiness formula — see domain.ComputeReadinessPct.
	c.ReadinessPct = domain.ComputeReadinessPct(c.DaysLeft, 40)
	return c, nil
}

// UpsertCalendar implements POST /daily/calendar.
type UpsertCalendar struct {
	Cal domain.CalendarRepo
	Now func() time.Time
}

// UpsertCalendarInput is the raw request payload.
type UpsertCalendarInput struct {
	UserID        uuid.UUID
	CompanyID     uuid.UUID
	Role          string
	InterviewDate time.Time
	CurrentLevel  string
}

// Do upserts and fills derived fields.
func (uc *UpsertCalendar) Do(ctx context.Context, in UpsertCalendarInput) (domain.InterviewCalendar, error) {
	if in.CompanyID == uuid.Nil {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.UpsertCalendar: company_id required")
	}
	c := domain.InterviewCalendar{
		UserID:        in.UserID,
		CompanyID:     in.CompanyID,
		Role:          in.Role,
		InterviewDate: in.InterviewDate,
		CurrentLevel:  in.CurrentLevel,
	}
	out, err := uc.Cal.Upsert(ctx, c)
	if err != nil {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.UpsertCalendar: %w", err)
	}
	now := uc.Now().UTC()
	out.DaysLeft = domain.DaysLeft(out.InterviewDate, now)
	out.ReadinessPct = domain.ComputeReadinessPct(out.DaysLeft, 40)
	return out, nil
}
