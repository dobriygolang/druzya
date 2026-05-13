//go:generate mockgen -package mocks -destination mocks/event_mock.go -source event.go
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

// EventVisibility mirrors the CHECK constraint on tutor_events.visibility
// (migration 00115). Default 'private' protects existing rows from
// accidental retroactive leak when the column was added.
type EventVisibility string

const (
	EventVisibilityPrivate EventVisibility = "private"
	EventVisibilityShared  EventVisibility = "shared"
)

// IsValid keeps exhaustiveness checks happy downstream.
func (v EventVisibility) IsValid() bool {
	switch v {
	case EventVisibilityPrivate, EventVisibilityShared:
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
	// (mirrored by SQL CHECK tutor_events_session_note_pair). Tutor-
	// visible always; student-visible only when Visibility==Shared
	// (Phase K T4, 2026-05-13). Used by Wave 9.5 analytics aggregations.
	SessionNote string
	// Phase K T4 — session-note share toggle. Default 'private' on insert
	// (migration 00115). Tutor opts in via SetSessionNoteVisibility.
	Visibility EventVisibility
	// Optional curated student-facing copy. Empty + Visibility=Shared =
	// «share full SessionNote as-is». Tutor can craft a polished version
	// without touching the private full note.
	SharedContentMD string
	// First-share stamp. Zero when never shared. Re-share refreshes it;
	// flipping back to private does NOT clear it (audit trail — student
	// may have already read).
	SharedAt  time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
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

	// TutorsActivitySummary — Phase K T6 (2026-05-12). Student-facing
	// social-proof aggregate. Returns one row per `tutorID` containing:
	//   - LastActiveAt: max of (created_at, scheduled_at, COALESCE updated_at)
	//     over events authored by this tutor (zero when none),
	//   - ActiveStudentCountOther: COUNT(active tutor_students) − 1
	//     (the caller is filtered out, floor 0),
	//   - RecentEventsCount: COUNT(tutor_events) inside `windowDays`
	//     (any status, aggregate-only, no event details).
	// `windowDays` <= 0 → 7. CallerID is needed to filter out the
	// requesting student from the «other» count. Missing tutorIDs
	// simply absent from the result map — server callers tolerate.
	TutorsActivitySummary(
		ctx context.Context,
		callerID uuid.UUID,
		tutorIDs []uuid.UUID,
		windowDays int,
		now time.Time,
	) (map[uuid.UUID]MyTutorActivity, error)

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

	// ── Session-note visibility (Phase K T4, 2026-05-13) ────────────

	// SetSessionNoteVisibility — tutor toggles share + optionally edits
	// the curated student-facing copy. Requires:
	//   * event owned by tutorID (else ErrNotFound)
	//   * event status='completed' (else ErrInvalidInput — note can't
	//     be shared before the session is closed)
	//   * visibility ∈ {private, shared} (else ErrInvalidInput)
	// Stamps shared_at on first private→shared transition; subsequent
	// shares refresh it. private toggle preserves shared_at as audit
	// trail of «student may have seen». Returns the refreshed Event.
	SetSessionNoteVisibility(
		ctx context.Context,
		tutorID, eventID uuid.UUID,
		visibility EventVisibility,
		sharedContentMD string,
		now time.Time,
	) (Event, error)

	// ListSharedSessionNotesForStudent — student-side feed. Returns
	// completed events targeting this student whose tutors opted in to
	// share the session note. Ordered shared_at DESC. Joined with users
	// for tutor display_name / avatar so handler doesn't N+1.
	// limit caps at 200; cursor "" = first page.
	ListSharedSessionNotesForStudent(
		ctx context.Context,
		studentID uuid.UUID,
		limit int,
		cursor string,
	) ([]SharedSessionNote, string, error)
}

// SharedSessionNote — student-side projection of a tutor's shared note.
// Aggregates event metadata + denormalised tutor display info so the
// student-side list rendering avoids N+1 lookups.
//
// SharedContentMD is the resolved student-facing copy: if the underlying
// row's shared_content_md is non-empty, it's used as-is; else falls back
// to the tutor's full session_note. Repo handles the COALESCE so callers
// always see non-empty content.
type SharedSessionNote struct {
	EventID          uuid.UUID
	EventTitle       string
	TutorID          uuid.UUID
	TutorDisplayName string
	TutorAvatarURL   string
	ScheduledAt      time.Time
	SharedAt         time.Time
	SharedContentMD  string
}

// MyTutorActivity — Phase K T6 student-facing summary per tutor.
// Privacy: ActiveStudentCountOther is COUNT-1 (excludes caller),
// RecentEventsCount is aggregate (no per-student / per-title detail).
type MyTutorActivity struct {
	TutorID                 uuid.UUID
	LastActiveAt            time.Time // zero == never
	ActiveStudentCountOther int
	RecentEventsCount       int
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
