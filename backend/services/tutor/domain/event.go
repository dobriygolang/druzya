package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Tutor events — Wave 5.2b of docs/feature/plan.md (Tutor Tier 3
// scheduled sessions). One-on-one lessons in V1; group classes via
// circle_id are wired into the schema (migration 00016) but not yet
// exposed by RPCs / UI — adding them in V2 doesn't require migration.

// EventStatus mirrors the CHECK constraint on tutor_events.status.
// Values are deliberately lowercase to match the SQL column directly
// — repo writes/reads them as-is, no enum-to-string adapter.
type EventStatus string

const (
	EventStatusScheduled EventStatus = "scheduled"
	EventStatusCancelled EventStatus = "cancelled"
	EventStatusCompleted EventStatus = "completed"
)

// IsValid keeps switches downstream exhaustive.
func (s EventStatus) IsValid() bool {
	switch s {
	case EventStatusScheduled, EventStatusCancelled, EventStatusCompleted:
		return true
	}
	return false
}

// Event mirrors a row in tutor_events. Exactly one of (StudentID,
// CircleID) is non-nil — enforced both by SQL CHECK and by Validate()
// below. Capacity is only set for circle (group) events; V1 1-on-1
// events leave it nil.
//
// EndsAt is a derived value (ScheduledAt + DurationMin); kept as a
// helper rather than a column to avoid the «two sources of truth» trap
// when the tutor edits duration.
type Event struct {
	ID                 uuid.UUID
	TutorID            uuid.UUID
	StudentID          *uuid.UUID // nil iff CircleID set
	CircleID           *uuid.UUID // nil iff StudentID set
	Title              string
	BodyMD             string
	ScheduledAt        time.Time
	DurationMin        int
	MeetURL            string
	Capacity           *int // nil for 1-on-1; positive for group
	Status             EventStatus
	CancellationReason string
	// Tutor's post-session write-up. Non-empty iff Status==Completed
	// (mirrored by SQL CHECK tutor_events_session_note_pair). Visible
	// to both tutor + student; used by Wave 9.5 analytics aggregations.
	SessionNote string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// EndsAt — convenience for callers wanting «when does this event end».
// Stays in sync with ScheduledAt + DurationMin without a separate column.
func (e Event) EndsAt() time.Time {
	return e.ScheduledAt.Add(time.Duration(e.DurationMin) * time.Minute)
}

// IsUpcoming = scheduled (not cancelled / completed) AND not yet over.
// «not yet over» (vs «not yet started») gives the user-facing UI a 1-h
// «happening now» window before the row falls out of upcoming.
func (e Event) IsUpcoming(now time.Time) bool {
	return e.Status == EventStatusScheduled && e.EndsAt().After(now)
}

// IsGroup returns true if the event targets a circle rather than a
// single student. Helper for UI rendering and access checks.
func (e Event) IsGroup() bool { return e.CircleID != nil }

// Validate checks invariants the use case layer enforces before
// hitting the SQL CHECKs. Caller (use case) calls it; the repo
// trusts validated input.
func (e Event) Validate() error {
	if e.TutorID == uuid.Nil {
		return ErrInvalidInput
	}
	if (e.StudentID != nil) == (e.CircleID != nil) {
		// XOR — both nil OR both set are equally invalid.
		return ErrInvalidInput
	}
	if e.StudentID != nil && *e.StudentID == e.TutorID {
		return ErrInvalidInput
	}
	if e.Title == "" {
		return ErrInvalidInput
	}
	if e.DurationMin <= 0 || e.DurationMin > 480 {
		return ErrInvalidInput
	}
	if e.ScheduledAt.IsZero() {
		return ErrInvalidInput
	}
	if e.Capacity != nil {
		// Capacity only makes sense for circle events (V2). V1 callers
		// pass nil; we still validate the cross-field rule defensively.
		if e.CircleID == nil || *e.Capacity <= 0 {
			return ErrInvalidInput
		}
	}
	if e.Status != "" && !e.Status.IsValid() {
		return ErrInvalidInput
	}
	return nil
}

// EventRepo is the persistence surface. Three list methods (tutor's
// own / student's incoming / by id) cover the access patterns the UI
// needs. A future analytics surface can add WindowedCount etc.
type EventRepo interface {
	// EnsureRelationship — same gate as AssignmentRepo. The use case
	// calls it before CreateEvent so a malicious tutor can't author
	// events for a student they're not connected to.
	EnsureRelationship(ctx context.Context, tutorID, studentID uuid.UUID) error

	// CreateEvent persists a new row. Caller has already validated.
	CreateEvent(ctx context.Context, e Event) (Event, error)

	// GetEvent loads a single row. Auth: requester is either the
	// authoring tutor OR the student on the row (V1) — V2 will
	// extend to «member of the target circle». ErrNotFound covers
	// «doesn't exist» and «exists but you can't see it».
	GetEvent(ctx context.Context, requesterID, eventID uuid.UUID) (Event, error)

	// CancelEvent stamps status=cancelled with a reason. Tutor-only.
	// ErrNotFound if the event doesn't belong to this tutor;
	// ErrInvalidInput if it's already terminal (cancelled / completed).
	CancelEvent(ctx context.Context, tutorID, eventID uuid.UUID, reason string, now time.Time) error

	// CompleteEvent stamps status=completed with a session note.
	// Tutor-only. Mirrors CancelEvent's terminal-detection semantics:
	// ErrNotFound for «not yours», ErrInvalidInput for «already
	// terminal». The session note is required (CHECK constraint
	// enforces non-empty for completed status).
	CompleteEvent(ctx context.Context, tutorID, eventID uuid.UUID, note string, now time.Time) error

	// ListByTutor returns all events authored by this tutor, most-
	// recently-scheduled first. limit caps the result.
	ListByTutor(ctx context.Context, tutorID uuid.UUID, limit int) ([]Event, error)

	// ListByTutorPaged — keyset cursor variant of ListByTutor.
	// Sort: scheduled_at DESC, id DESC. cursor "" = first page.
	ListByTutorPaged(ctx context.Context, tutorID uuid.UUID, limit int, cursor string) ([]Event, string, error)

	// ListUpcomingForStudent — the hot student-side read path. Returns
	// scheduled events targeting this student (V1: 1-on-1 only; V2
	// will UNION events via circles the student is a member of) where
	// EndsAt > now. Ordered earliest-first.
	ListUpcomingForStudent(ctx context.Context, studentID uuid.UUID, now time.Time, limit int) ([]Event, error)

	// ListUpcomingForStudentPaged — keyset cursor variant.
	// Sort: scheduled_at ASC, id ASC. Walks forward through the
	// upcoming queue (cursor advances older→newer because earliest-
	// scheduled lands first).
	ListUpcomingForStudentPaged(ctx context.Context, studentID uuid.UUID, now time.Time, limit int, cursor string) ([]Event, string, error)

	// TutorEventStats — Wave 9.5 analytics aggregate. Returns counts +
	// total minutes taught for completed events authored by this tutor
	// inside `windowDays`. cancellation_rate computed from the same
	// window. Read-only; meant to back the tutor dashboard «Activity»
	// card. Returns zero struct (no error) when tutor has no events.
	TutorEventStats(ctx context.Context, tutorID uuid.UUID, windowDays int, now time.Time) (TutorActivity, error)

	// ── Wave 5.2 group events on circles ─────────────────────────

	// EnsureCircleOwner returns ErrNotFound if tutor isn't the owner
	// (or admin) of the circle. Tutors can only schedule group events
	// for circles they manage — defends against authoring on a circle
	// they happen to be a regular member of.
	EnsureCircleOwner(ctx context.Context, tutorID, circleID uuid.UUID) error

	// EnsureCircleMember returns ErrNotFound if studentID isn't a
	// member of the circle. Used by JoinEvent / ListUpcoming UNION to
	// gate access on group events.
	EnsureCircleMember(ctx context.Context, studentID, circleID uuid.UUID) error

	// JoinEvent atomically: 1) verifies event is scheduled (not past
	// cap or terminal), 2) checks current RSVP count vs capacity, 3)
	// inserts row in tutor_event_rsvps with ON CONFLICT DO NOTHING
	// (re-join is idempotent). Returns ErrCapacityFull when at limit.
	JoinEvent(ctx context.Context, studentID, eventID uuid.UUID, now time.Time) error

	// LeaveEvent removes the student's RSVP. Idempotent — leaving an
	// event you weren't in returns nil (matches the «no surprises»
	// REST principle for cancel-style operations).
	LeaveEvent(ctx context.Context, studentID, eventID uuid.UUID) error

	// ListEventRSVPCount returns the current RSVP count for a single
	// event. Cheap COUNT query; used by the UI to render «3/10 joined»
	// chips without a full participant list.
	ListEventRSVPCount(ctx context.Context, eventID uuid.UUID) (int, error)

	// ListUpcomingGroupEventsForStudent — events the student can see
	// because they're a member of the target circle. Excludes events
	// they've already joined (those flow through ListUpcomingForStudent
	// after JoinEvent — the partial-idx-friendly path). UNION-friendly
	// shape: same Event + signal of capacity remaining via separate
	// ListEventRSVPCount.
	ListUpcomingGroupEventsForStudent(ctx context.Context, studentID uuid.UUID, now time.Time, limit int) ([]Event, error)
}

// TutorActivity — aggregated tutor-side metrics for Wave 9.5 dashboard.
type TutorActivity struct {
	WindowDays         int
	ActiveStudentCount int     // ListTutorStudents → count
	EventsCompleted    int     // status='completed' inside window
	EventsCancelled    int     // status='cancelled' inside window
	EventsScheduled    int     // status='scheduled' inside window (regardless of past/future)
	MinutesTaught      int     // SUM(duration_min) over completed events
	CancellationRate   float64 // cancelled / (completed + cancelled), 0 when no events
	// Phase 8 — rolling daily counts (window-length series) for sparkline UI.
	// Day-buckets oldest → newest. Length = WindowDays. Counts == completed
	// events per day; minutes — SUM(duration) per day.
	DailyCompleted []int
	DailyMinutes   []int
}
