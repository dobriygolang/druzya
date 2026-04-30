// Package domain — Calendar bounded context.
//
// Calendar owns *personal* events: interviews, deadlines, exams, club
// session reflections, ad-hoc study blocks. Distinct from
// services/events (which is circle-scoped) — there are no participants
// on a personal event, only the owner.
//
// Single source of truth for "what's coming up for me?". Read by:
//   - intelligence (severity grading, AI coach prompt)
//   - Hone Today  (chip ribbon)
//   - web /calendar (full month view)
//   - notify     (T-1d reminders, T-1h escalations)
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Kind classifies what a personal event represents. The set is closed —
// new entries require a SQL migration extending the personal_event_kind
// enum, intentionally so the AI coach's severity rules stay exhaustive.
type Kind string

const (
	KindInterview          Kind = "interview"
	KindDeadline           Kind = "deadline"
	KindExam               Kind = "exam"
	KindClubSession        Kind = "club_session"
	KindStudyBlock         Kind = "study_block"
	KindInterviewPrepBlock Kind = "interview_prep_block"
)

// IsValid returns true for known kinds.
func (k Kind) IsValid() bool {
	switch k {
	case KindInterview, KindDeadline, KindExam,
		KindClubSession, KindStudyBlock, KindInterviewPrepBlock:
		return true
	}
	return false
}

// Status is the personal-event lifecycle state.
type Status string

const (
	StatusPlanned   Status = "planned"
	StatusLive      Status = "live"
	StatusDone      Status = "done"
	StatusCancelled Status = "cancelled"
	StatusNoShow    Status = "no_show"
)

// IsValid returns true for known statuses.
func (s Status) IsValid() bool {
	switch s {
	case StatusPlanned, StatusLive, StatusDone, StatusCancelled, StatusNoShow:
		return true
	}
	return false
}

// Source records who created the event. Used by the coach to know whether
// to challenge an AI-generated suggestion vs. trust a user-confirmed one.
type Source string

const (
	SourceUser          Source = "user"
	SourceAI            Source = "ai"
	SourceClubCurator   Source = "club_curator"
	SourceIntegrationTG Source = "integration_tg"
)

// IsValid returns true for known sources.
func (s Source) IsValid() bool {
	switch s {
	case SourceUser, SourceAI, SourceClubCurator, SourceIntegrationTG:
		return true
	}
	return false
}

// Event is a personal calendar row. End-times are optional so the same
// row models both "Yandex interview Friday 14:00, 1.5h" and "Final paper
// due Tuesday" without two shapes.
type Event struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Kind        Kind
	Title       string
	Description string
	StartsAt    time.Time
	EndsAt      *time.Time
	AllDay      bool

	// Cross-context anchors. All optional — the coach reads them when
	// present, ignores them when nil.
	CompanyID        *uuid.UUID
	Role             string
	CurrentLevel     string
	ReadinessPct     int
	CodexArticleSlug string
	TrackID          *uuid.UUID
	ClubSessionID    *uuid.UUID

	Status     Status
	OutcomeMD  string
	FeltScore  *int // 1..5 self-reported, post-event
	FinishedAt *time.Time

	Source    Source
	CreatedAt time.Time
	UpdatedAt time.Time
}

// IsUpcoming reports whether the event is in the future relative to `now`.
// Treats all_day events as upcoming through their starting day.
func (e Event) IsUpcoming(now time.Time) bool {
	if e.Status != StatusPlanned {
		return false
	}
	if e.AllDay {
		dayStart := e.StartsAt.UTC().Truncate(24 * time.Hour)
		nowDay := now.UTC().Truncate(24 * time.Hour)
		return !dayStart.Before(nowDay)
	}
	return e.StartsAt.After(now)
}

// DaysFromNow returns the integer-day difference between the event start
// and `now`. Negative for past events, 0 for today.
func (e Event) DaysFromNow(now time.Time) int {
	dayStart := e.StartsAt.UTC().Truncate(24 * time.Hour)
	nowDay := now.UTC().Truncate(24 * time.Hour)
	return int(dayStart.Sub(nowDay).Hours() / 24)
}

// EventWithCompany — read projection joined to companies(name) so the UI
// doesn't fan out one row per call. Empty CompanyName when CompanyID nil.
type EventWithCompany struct {
	Event
	CompanyName string
}

// Domain errors.
var (
	ErrNotFound     = errors.New("calendar: not found")
	ErrForbidden    = errors.New("calendar: forbidden")
	ErrInvalidInput = errors.New("calendar: invalid input")
)
