// events.go — Wave 5.2b of docs/feature/plan.md (Tutor Tier 3 events).
// Four use cases — Create / Cancel / ListByTutor / ListUpcomingForStudent.
// Auth gates live here: tutor-side writes go through EnsureRelationship,
// student-side reads are scoped by the SQL predicate (`student_id = $1`)
// in the repo so a malicious student can't probe foreign event ids.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// EventTitleMax / EventBodyMax — input caps. Same scale as assignments;
// past these the tutor should be linking out to a Reading-материал
// instead of pasting longform into a calendar entry.
const (
	EventTitleMax    = 240
	EventBodyMax     = 4_000
	EventDurationMax = 480 // 8h, mirrors the SQL CHECK
	// MeetURL surface cap — generous to allow long shareable links
	// (Zoom invites can include a ~150-char passcode segment).
	EventMeetURLMax = 2_000
	// CancellationReason — short rationale for the student-side
	// «cancelled because: …» notice.
	EventCancellationReasonMax = 500
)

// Earliest a tutor can schedule an event from now. We allow a small
// negative window (5 min) so a tutor can quickly create an «we're
// starting now» event without bumping minutes on the picker — anything
// further into the past is a typo.
const eventScheduledAtSlack = -5 * time.Minute

// CreateEvent — tutor authors a new calendar entry. V1 supports the
// 1-on-1 (StudentID set) flow only; circle (group) creation requires
// V2 access checks (tutor must own the circle, etc.) and is not
// exposed from this use case yet.
type CreateEvent struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

type CreateEventInput struct {
	TutorID     uuid.UUID
	StudentID   uuid.UUID // V1: required (group / circle path lives in a separate UC)
	Title       string
	BodyMD      string
	ScheduledAt time.Time
	DurationMin int
	MeetURL     string
}

func (uc *CreateEvent) Do(ctx context.Context, in CreateEventInput) (domain.Event, error) {
	if in.TutorID == uuid.Nil || in.StudentID == uuid.Nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: %w", domain.ErrInvalidInput)
	}
	if in.TutorID == in.StudentID {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: cannot self-schedule")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: title required: %w", domain.ErrInvalidInput)
	}
	if len(title) > EventTitleMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: title too long: %w", domain.ErrInvalidInput)
	}
	body := strings.TrimSpace(in.BodyMD)
	if len(body) > EventBodyMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: body too long: %w", domain.ErrInvalidInput)
	}
	meetURL := strings.TrimSpace(in.MeetURL)
	if len(meetURL) > EventMeetURLMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: meet_url too long: %w", domain.ErrInvalidInput)
	}
	if in.DurationMin <= 0 || in.DurationMin > EventDurationMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: duration_min out of range: %w", domain.ErrInvalidInput)
	}
	if in.ScheduledAt.IsZero() {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: scheduled_at required: %w", domain.ErrInvalidInput)
	}
	now := nowOr(uc.Now)
	if in.ScheduledAt.Before(now.Add(eventScheduledAtSlack)) {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: scheduled_at in the past: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.EnsureRelationship(ctx, in.TutorID, in.StudentID); err != nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: %w", err)
	}
	studentID := in.StudentID
	candidate := domain.Event{
		TutorID:     in.TutorID,
		StudentID:   &studentID,
		Title:       title,
		BodyMD:      body,
		ScheduledAt: in.ScheduledAt.UTC(),
		DurationMin: in.DurationMin,
		MeetURL:     meetURL,
		Status:      domain.EventStatusScheduled,
	}
	if err := candidate.Validate(); err != nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: %w", err)
	}
	saved, err := uc.Repo.CreateEvent(ctx, candidate)
	if err != nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateEvent: %w", err)
	}
	return saved, nil
}

// EventSessionNoteMax caps the post-session write-up. 8KB is generous
// — typical session notes are 200-500 words; past 8KB the tutor should
// be linking to a Hone Note instead.
const EventSessionNoteMax = 8_000

// CompleteEvent — tutor stamps status=completed after the session has
// happened, attaching a session note. Mirrors CancelEvent's semantics:
// already-terminal events return ErrInvalidInput; foreign events return
// ErrNotFound. The session note is required (mirrors SQL CHECK) so the
// tutor can't accidentally close a session without recording outcomes.
type CompleteEvent struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

type CompleteEventInput struct {
	TutorID     uuid.UUID
	EventID     uuid.UUID
	SessionNote string
}

func (uc *CompleteEvent) Do(ctx context.Context, in CompleteEventInput) error {
	if in.TutorID == uuid.Nil || in.EventID == uuid.Nil {
		return fmt.Errorf("tutor.CompleteEvent: %w", domain.ErrInvalidInput)
	}
	note := strings.TrimSpace(in.SessionNote)
	if note == "" {
		return fmt.Errorf("tutor.CompleteEvent: session_note required: %w", domain.ErrInvalidInput)
	}
	if len(note) > EventSessionNoteMax {
		return fmt.Errorf("tutor.CompleteEvent: session_note too long: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.CompleteEvent(ctx, in.TutorID, in.EventID, note, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.CompleteEvent: %w", err)
	}
	return nil
}

// CancelEvent — tutor stamps status=cancelled with a reason. Already-
// terminal events propagate ErrInvalidInput (handler maps to
// FailedPrecondition) so the caller can show «event already cancelled»
// rather than silently confusing the user.
type CancelEvent struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

type CancelEventInput struct {
	TutorID uuid.UUID
	EventID uuid.UUID
	Reason  string
}

func (uc *CancelEvent) Do(ctx context.Context, in CancelEventInput) error {
	if in.TutorID == uuid.Nil || in.EventID == uuid.Nil {
		return fmt.Errorf("tutor.CancelEvent: %w", domain.ErrInvalidInput)
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		// SQL CHECK requires a non-empty reason when cancelling. Surface
		// this at the use case so the UI gets a clean InvalidInput
		// rather than a 500 from a constraint violation.
		return fmt.Errorf("tutor.CancelEvent: reason required: %w", domain.ErrInvalidInput)
	}
	if len(reason) > EventCancellationReasonMax {
		return fmt.Errorf("tutor.CancelEvent: reason too long: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.CancelEvent(ctx, in.TutorID, in.EventID, reason, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.CancelEvent: %w", err)
	}
	return nil
}

// ListEventsForTutor — tutor's calendar list, all statuses, most-
// recently-scheduled first.
type ListEventsForTutor struct {
	Repo domain.EventRepo
}

// ListEventsForTutorOutput — items + opaque next cursor (empty = end).
type ListEventsForTutorOutput struct {
	Items      []domain.Event
	NextCursor string
}

func (uc *ListEventsForTutor) Do(ctx context.Context, tutorID uuid.UUID, limit int, cursor string) (ListEventsForTutorOutput, error) {
	if tutorID == uuid.Nil {
		return ListEventsForTutorOutput{}, fmt.Errorf("tutor.ListEventsForTutor: %w", domain.ErrInvalidInput)
	}
	out, next, err := uc.Repo.ListByTutorPaged(ctx, tutorID, limit, cursor)
	if err != nil {
		return ListEventsForTutorOutput{}, fmt.Errorf("tutor.ListEventsForTutor: %w", err)
	}
	return ListEventsForTutorOutput{Items: out, NextCursor: next}, nil
}

// ── Wave 5.2 group events on circles ─────────────────────────────

// EventCapacityMax bounds capacity to a sane upper limit. Past 200
// the event is no longer a «class» but a webinar — different surface.
const EventCapacityMax = 200

// CreateGroupEvent — tutor schedules an event bound to a circle (group
// class). EnsureCircleOwner gate; capacity required (1..200); same
// time validation as 1-on-1 CreateEvent.
type CreateGroupEvent struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

type CreateGroupEventInput struct {
	TutorID     uuid.UUID
	CircleID    uuid.UUID
	Title       string
	BodyMD      string
	ScheduledAt time.Time
	DurationMin int
	MeetURL     string
	Capacity    int // required, 1..EventCapacityMax
}

func (uc *CreateGroupEvent) Do(ctx context.Context, in CreateGroupEventInput) (domain.Event, error) {
	if in.TutorID == uuid.Nil || in.CircleID == uuid.Nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: %w", domain.ErrInvalidInput)
	}
	title := strings.TrimSpace(in.Title)
	if title == "" || len(title) > EventTitleMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: title invalid: %w", domain.ErrInvalidInput)
	}
	body := strings.TrimSpace(in.BodyMD)
	if len(body) > EventBodyMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: body too long: %w", domain.ErrInvalidInput)
	}
	meetURL := strings.TrimSpace(in.MeetURL)
	if len(meetURL) > EventMeetURLMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: meet_url too long: %w", domain.ErrInvalidInput)
	}
	if in.DurationMin <= 0 || in.DurationMin > EventDurationMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: duration_min out of range: %w", domain.ErrInvalidInput)
	}
	if in.Capacity <= 0 || in.Capacity > EventCapacityMax {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: capacity out of range: %w", domain.ErrInvalidInput)
	}
	if in.ScheduledAt.IsZero() {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: scheduled_at required: %w", domain.ErrInvalidInput)
	}
	now := nowOr(uc.Now)
	if in.ScheduledAt.Before(now.Add(eventScheduledAtSlack)) {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: scheduled_at in the past: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.EnsureCircleOwner(ctx, in.TutorID, in.CircleID); err != nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: %w", err)
	}
	circleID := in.CircleID
	cap := in.Capacity
	candidate := domain.Event{
		TutorID:     in.TutorID,
		CircleID:    &circleID,
		Title:       title,
		BodyMD:      body,
		ScheduledAt: in.ScheduledAt.UTC(),
		DurationMin: in.DurationMin,
		MeetURL:     meetURL,
		Capacity:    &cap,
		Status:      domain.EventStatusScheduled,
	}
	if err := candidate.Validate(); err != nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: %w", err)
	}
	saved, err := uc.Repo.CreateEvent(ctx, candidate)
	if err != nil {
		return domain.Event{}, fmt.Errorf("tutor.CreateGroupEvent: %w", err)
	}
	return saved, nil
}

// JoinEvent — student RSVPs to a group event. Repo enforces capacity
// transactionally. ErrCapacityFull when at limit; ErrNotFound when
// event isn't a group event or doesn't exist; ErrInvalidInput when
// event is no longer scheduled (cancelled/completed).
type JoinEvent struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

func (uc *JoinEvent) Do(ctx context.Context, studentID, eventID uuid.UUID) error {
	if studentID == uuid.Nil || eventID == uuid.Nil {
		return fmt.Errorf("tutor.JoinEvent: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.JoinEvent(ctx, studentID, eventID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.JoinEvent: %w", err)
	}
	return nil
}

// LeaveEvent — student withdraws RSVP. Idempotent.
type LeaveEvent struct {
	Repo domain.EventRepo
}

func (uc *LeaveEvent) Do(ctx context.Context, studentID, eventID uuid.UUID) error {
	if studentID == uuid.Nil || eventID == uuid.Nil {
		return fmt.Errorf("tutor.LeaveEvent: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.LeaveEvent(ctx, studentID, eventID); err != nil {
		return fmt.Errorf("tutor.LeaveEvent: %w", err)
	}
	return nil
}

// ListUpcomingGroupEventsForStudent — student-side calendar feed for
// group events on circles they're a member of.
type ListUpcomingGroupEventsForStudent struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

func (uc *ListUpcomingGroupEventsForStudent) Do(ctx context.Context, studentID uuid.UUID, limit int) ([]domain.Event, error) {
	if studentID == uuid.Nil {
		return nil, fmt.Errorf("tutor.ListUpcomingGroupEventsForStudent: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.ListUpcomingGroupEventsForStudent(ctx, studentID, nowOr(uc.Now), limit)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListUpcomingGroupEventsForStudent: %w", err)
	}
	return out, nil
}

// GetEventRSVPCount — read-only counter; used by both tutor (their own
// group events) and students (visible group events they're considering
// joining). No auth gate here — count is public among circle members
// who can already see the event row.
type GetEventRSVPCount struct {
	Repo domain.EventRepo
}

func (uc *GetEventRSVPCount) Do(ctx context.Context, eventID uuid.UUID) (int, error) {
	if eventID == uuid.Nil {
		return 0, fmt.Errorf("tutor.GetEventRSVPCount: %w", domain.ErrInvalidInput)
	}
	count, err := uc.Repo.ListEventRSVPCount(ctx, eventID)
	if err != nil {
		return 0, fmt.Errorf("tutor.GetEventRSVPCount: %w", err)
	}
	return count, nil
}

// GetTutorActivity — Wave 9.5 analytics aggregate use case. windowDays
// defaults to 30 in the repo. Pure pass-through with the standard
// zero-id guard.
type GetTutorActivity struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

func (uc *GetTutorActivity) Do(ctx context.Context, tutorID uuid.UUID, windowDays int) (domain.TutorActivity, error) {
	if tutorID == uuid.Nil {
		return domain.TutorActivity{}, fmt.Errorf("tutor.GetTutorActivity: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.TutorEventStats(ctx, tutorID, windowDays, nowOr(uc.Now))
	if err != nil {
		return domain.TutorActivity{}, fmt.Errorf("tutor.GetTutorActivity: %w", err)
	}
	return out, nil
}

// ListUpcomingEventsForStudent — student's calendar feed: scheduled
// events whose end time hasn't passed yet. Earliest-first.
type ListUpcomingEventsForStudent struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

// ListUpcomingEventsForStudentOutput — items + opaque next cursor.
type ListUpcomingEventsForStudentOutput struct {
	Items      []domain.Event
	NextCursor string
}

func (uc *ListUpcomingEventsForStudent) Do(ctx context.Context, studentID uuid.UUID, limit int, cursor string) (ListUpcomingEventsForStudentOutput, error) {
	if studentID == uuid.Nil {
		return ListUpcomingEventsForStudentOutput{}, fmt.Errorf("tutor.ListUpcomingEventsForStudent: %w", domain.ErrInvalidInput)
	}
	out, next, err := uc.Repo.ListUpcomingForStudentPaged(ctx, studentID, nowOr(uc.Now), limit, cursor)
	if err != nil {
		return ListUpcomingEventsForStudentOutput{}, fmt.Errorf("tutor.ListUpcomingEventsForStudent: %w", err)
	}
	return ListUpcomingEventsForStudentOutput{Items: out, NextCursor: next}, nil
}
