package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// fakeEventRepo — hand-rolled fake. Same convention as the assignment
// fake: nil closure = «not expected», surfaces a typed error so the
// failing test points at the right field.
type fakeEventRepo struct {
	ensure      func(ctx context.Context, tutorID, studentID uuid.UUID) error
	create      func(ctx context.Context, e domain.Event) (domain.Event, error)
	get         func(ctx context.Context, requesterID, eventID uuid.UUID) (domain.Event, error)
	cancel      func(ctx context.Context, tutorID, eventID uuid.UUID, reason string, now time.Time) error
	complete    func(ctx context.Context, tutorID, eventID uuid.UUID, note string, now time.Time) error
	listTutor   func(ctx context.Context, tutorID uuid.UUID, limit int) ([]domain.Event, error)
	listStudent func(ctx context.Context, studentID uuid.UUID, now time.Time, limit int) ([]domain.Event, error)
}

func (f fakeEventRepo) EnsureRelationship(ctx context.Context, t, s uuid.UUID) error {
	if f.ensure == nil {
		return errors.New("ensure not set")
	}
	return f.ensure(ctx, t, s)
}
func (f fakeEventRepo) CreateEvent(ctx context.Context, e domain.Event) (domain.Event, error) {
	if f.create == nil {
		return domain.Event{}, errors.New("create not set")
	}
	return f.create(ctx, e)
}
func (f fakeEventRepo) GetEvent(ctx context.Context, r, e uuid.UUID) (domain.Event, error) {
	if f.get == nil {
		return domain.Event{}, errors.New("get not set")
	}
	return f.get(ctx, r, e)
}
func (f fakeEventRepo) CancelEvent(ctx context.Context, t, e uuid.UUID, reason string, now time.Time) error {
	if f.cancel == nil {
		return errors.New("cancel not set")
	}
	return f.cancel(ctx, t, e, reason, now)
}
func (f fakeEventRepo) CompleteEvent(ctx context.Context, t, e uuid.UUID, note string, now time.Time) error {
	if f.complete == nil {
		return errors.New("complete not set")
	}
	return f.complete(ctx, t, e, note, now)
}
func (f fakeEventRepo) ListByTutor(ctx context.Context, t uuid.UUID, l int) ([]domain.Event, error) {
	if f.listTutor == nil {
		return nil, errors.New("listTutor not set")
	}
	return f.listTutor(ctx, t, l)
}
func (f fakeEventRepo) ListByTutorPaged(ctx context.Context, t uuid.UUID, l int, _ string) ([]domain.Event, string, error) {
	if f.listTutor == nil {
		return nil, "", errors.New("listTutor not set")
	}
	rows, err := f.listTutor(ctx, t, l)
	return rows, "", err
}
func (f fakeEventRepo) ListUpcomingForStudent(ctx context.Context, s uuid.UUID, now time.Time, l int) ([]domain.Event, error) {
	if f.listStudent == nil {
		return nil, errors.New("listStudent not set")
	}
	return f.listStudent(ctx, s, now, l)
}
func (f fakeEventRepo) ListUpcomingForStudentPaged(ctx context.Context, s uuid.UUID, now time.Time, l int, _ string) ([]domain.Event, string, error) {
	if f.listStudent == nil {
		return nil, "", errors.New("listStudent not set")
	}
	rows, err := f.listStudent(ctx, s, now, l)
	return rows, "", err
}
func (f fakeEventRepo) TutorEventStats(_ context.Context, _ uuid.UUID, _ int, _ time.Time) (domain.TutorActivity, error) {
	return domain.TutorActivity{}, nil
}
func (f fakeEventRepo) EnsureCircleOwner(_ context.Context, _, _ uuid.UUID) error  { return nil }
func (f fakeEventRepo) EnsureCircleMember(_ context.Context, _, _ uuid.UUID) error { return nil }
func (f fakeEventRepo) JoinEvent(_ context.Context, _, _ uuid.UUID, _ time.Time) error {
	return nil
}
func (f fakeEventRepo) LeaveEvent(_ context.Context, _, _ uuid.UUID) error             { return nil }
func (f fakeEventRepo) ListEventRSVPCount(_ context.Context, _ uuid.UUID) (int, error) { return 0, nil }
func (f fakeEventRepo) ListUpcomingGroupEventsForStudent(_ context.Context, _ uuid.UUID, _ time.Time, _ int) ([]domain.Event, error) {
	return nil, nil
}

// ── CreateEvent ───────────────────────────────────────────────────

func TestCreateEvent_HappyPath(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	studentID := uuid.New()
	future := time.Now().Add(2 * time.Hour)

	ensureCalls := 0
	repo := fakeEventRepo{
		ensure: func(_ context.Context, tt, st uuid.UUID) error {
			ensureCalls++
			if tt != tutorID || st != studentID {
				t.Errorf("ensure ids mismatch: %v %v", tt, st)
			}
			return nil
		},
		create: func(_ context.Context, e domain.Event) (domain.Event, error) {
			if e.StudentID == nil || *e.StudentID != studentID {
				t.Errorf("student_id not propagated: %v", e.StudentID)
			}
			if e.CircleID != nil {
				t.Errorf("V1 must not set CircleID: %v", e.CircleID)
			}
			if e.Status != domain.EventStatusScheduled {
				t.Errorf("status default broken: %s", e.Status)
			}
			e.ID = uuid.New()
			return e, nil
		},
	}
	uc := &CreateEvent{Repo: repo}
	out, err := uc.Do(context.Background(), CreateEventInput{
		TutorID:     tutorID,
		StudentID:   studentID,
		Title:       "  Weekly 1-on-1  ",
		BodyMD:      "  Bring questions about ch.4  ",
		ScheduledAt: future,
		DurationMin: 60,
		MeetURL:     "  https://meet.example.com/abc  ",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if ensureCalls != 1 {
		t.Errorf("ensure expected 1 call, got %d", ensureCalls)
	}
	if out.Title != "Weekly 1-on-1" || out.BodyMD != "Bring questions about ch.4" {
		t.Errorf("input not trimmed: %+v", out)
	}
	if out.MeetURL != "https://meet.example.com/abc" {
		t.Errorf("meet_url not trimmed: %q", out.MeetURL)
	}
}

func TestCreateEvent_RejectsBadInput(t *testing.T) {
	t.Parallel()
	repo := fakeEventRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error {
			t.Fatal("ensure must not be called for bad input")
			return nil
		},
	}
	uc := &CreateEvent{Repo: repo}
	future := time.Now().Add(time.Hour)
	cases := []struct {
		name string
		in   CreateEventInput
	}{
		{"zero tutor_id", CreateEventInput{StudentID: uuid.New(), Title: "x", ScheduledAt: future, DurationMin: 30}},
		{"zero student_id", CreateEventInput{TutorID: uuid.New(), Title: "x", ScheduledAt: future, DurationMin: 30}},
		{"self-schedule", func() CreateEventInput {
			id := uuid.New()
			return CreateEventInput{TutorID: id, StudentID: id, Title: "x", ScheduledAt: future, DurationMin: 30}
		}()},
		{"empty title", CreateEventInput{TutorID: uuid.New(), StudentID: uuid.New(), Title: "  ", ScheduledAt: future, DurationMin: 30}},
		{"oversize title", CreateEventInput{
			TutorID: uuid.New(), StudentID: uuid.New(),
			Title:       strings.Repeat("a", EventTitleMax+1),
			ScheduledAt: future, DurationMin: 30,
		}},
		{"oversize body", CreateEventInput{
			TutorID: uuid.New(), StudentID: uuid.New(),
			Title:       "x",
			BodyMD:      strings.Repeat("b", EventBodyMax+1),
			ScheduledAt: future, DurationMin: 30,
		}},
		{"oversize meet_url", CreateEventInput{
			TutorID: uuid.New(), StudentID: uuid.New(),
			Title:       "x",
			ScheduledAt: future, DurationMin: 30,
			MeetURL: strings.Repeat("u", EventMeetURLMax+1),
		}},
		{"duration zero", CreateEventInput{
			TutorID: uuid.New(), StudentID: uuid.New(),
			Title: "x", ScheduledAt: future, DurationMin: 0,
		}},
		{"duration too long", CreateEventInput{
			TutorID: uuid.New(), StudentID: uuid.New(),
			Title: "x", ScheduledAt: future, DurationMin: EventDurationMax + 1,
		}},
		{"scheduled_at zero", CreateEventInput{
			TutorID: uuid.New(), StudentID: uuid.New(),
			Title: "x", ScheduledAt: time.Time{}, DurationMin: 30,
		}},
		{"scheduled_at deeply in past", CreateEventInput{
			TutorID: uuid.New(), StudentID: uuid.New(),
			Title:       "x",
			ScheduledAt: time.Now().Add(-2 * time.Hour),
			DurationMin: 30,
		}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if _, err := uc.Do(context.Background(), c.in); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

// «Now-ish» events (2 minutes in the past) should be allowed to
// support «we're starting in a moment» flow. The 5-minute slack
// window in `eventScheduledAtSlack` covers this.
func TestCreateEvent_AcceptsNowIshScheduling(t *testing.T) {
	t.Parallel()
	tutorID, studentID := uuid.New(), uuid.New()
	repo := fakeEventRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error { return nil },
		create: func(_ context.Context, e domain.Event) (domain.Event, error) {
			e.ID = uuid.New()
			return e, nil
		},
	}
	uc := &CreateEvent{Repo: repo}
	if _, err := uc.Do(context.Background(), CreateEventInput{
		TutorID:     tutorID,
		StudentID:   studentID,
		Title:       "instant",
		ScheduledAt: time.Now().Add(-2 * time.Minute),
		DurationMin: 30,
	}); err != nil {
		t.Errorf("now-ish events should be allowed: %v", err)
	}
}

func TestCreateEvent_RelationshipMissing(t *testing.T) {
	t.Parallel()
	repo := fakeEventRepo{
		ensure: func(_ context.Context, _, _ uuid.UUID) error { return domain.ErrNotFound },
	}
	uc := &CreateEvent{Repo: repo}
	_, err := uc.Do(context.Background(), CreateEventInput{
		TutorID:     uuid.New(),
		StudentID:   uuid.New(),
		Title:       "x",
		ScheduledAt: time.Now().Add(time.Hour),
		DurationMin: 30,
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

// ── CancelEvent ──────────────────────────────────────────────────

func TestCancelEvent_HappyPath(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	eventID := uuid.New()
	repo := fakeEventRepo{
		cancel: func(_ context.Context, tt, eid uuid.UUID, reason string, _ time.Time) error {
			if tt != tutorID || eid != eventID {
				t.Errorf("cancel ids mismatch: %v %v", tt, eid)
			}
			if reason != "Sick today" {
				t.Errorf("reason not trimmed: %q", reason)
			}
			return nil
		},
	}
	uc := &CancelEvent{Repo: repo}
	if err := uc.Do(context.Background(), CancelEventInput{
		TutorID: tutorID, EventID: eventID, Reason: "  Sick today  ",
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestCancelEvent_RejectsBadInput(t *testing.T) {
	t.Parallel()
	uc := &CancelEvent{Repo: fakeEventRepo{}}
	cases := []struct {
		name string
		in   CancelEventInput
	}{
		{"zero ids", CancelEventInput{Reason: "x"}},
		{"empty reason", CancelEventInput{TutorID: uuid.New(), EventID: uuid.New(), Reason: "  "}},
		{"oversize reason", CancelEventInput{
			TutorID: uuid.New(), EventID: uuid.New(),
			Reason: strings.Repeat("r", EventCancellationReasonMax+1),
		}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if err := uc.Do(context.Background(), c.in); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

func TestCancelEvent_AlreadyTerminalPropagates(t *testing.T) {
	t.Parallel()
	repo := fakeEventRepo{
		cancel: func(_ context.Context, _, _ uuid.UUID, _ string, _ time.Time) error {
			return domain.ErrInvalidInput
		},
	}
	uc := &CancelEvent{Repo: repo}
	err := uc.Do(context.Background(), CancelEventInput{
		TutorID: uuid.New(), EventID: uuid.New(), Reason: "x",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

// ── CompleteEvent ────────────────────────────────────────────────

func TestCompleteEvent_HappyPath(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	eventID := uuid.New()
	repo := fakeEventRepo{
		complete: func(_ context.Context, tt, eid uuid.UUID, note string, _ time.Time) error {
			if tt != tutorID || eid != eventID {
				t.Errorf("ids mismatch: %v %v", tt, eid)
			}
			if note != "Covered ch.4 + chunking" {
				t.Errorf("note not trimmed: %q", note)
			}
			return nil
		},
	}
	uc := &CompleteEvent{Repo: repo}
	if err := uc.Do(context.Background(), CompleteEventInput{
		TutorID: tutorID, EventID: eventID,
		SessionNote: "  Covered ch.4 + chunking  ",
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestCompleteEvent_RejectsBadInput(t *testing.T) {
	t.Parallel()
	uc := &CompleteEvent{Repo: fakeEventRepo{}}
	cases := []struct {
		name string
		in   CompleteEventInput
	}{
		{"zero ids", CompleteEventInput{SessionNote: "ok"}},
		{"empty note", CompleteEventInput{
			TutorID: uuid.New(), EventID: uuid.New(), SessionNote: "  ",
		}},
		{"oversize note", CompleteEventInput{
			TutorID: uuid.New(), EventID: uuid.New(),
			SessionNote: strings.Repeat("n", EventSessionNoteMax+1),
		}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if err := uc.Do(context.Background(), c.in); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

func TestCompleteEvent_AlreadyTerminalPropagates(t *testing.T) {
	t.Parallel()
	repo := fakeEventRepo{
		complete: func(_ context.Context, _, _ uuid.UUID, _ string, _ time.Time) error {
			return domain.ErrInvalidInput
		},
	}
	uc := &CompleteEvent{Repo: repo}
	if err := uc.Do(context.Background(), CompleteEventInput{
		TutorID: uuid.New(), EventID: uuid.New(), SessionNote: "x",
	}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCompleteEvent_NotFoundPropagates(t *testing.T) {
	t.Parallel()
	repo := fakeEventRepo{
		complete: func(_ context.Context, _, _ uuid.UUID, _ string, _ time.Time) error {
			return domain.ErrNotFound
		},
	}
	uc := &CompleteEvent{Repo: repo}
	if err := uc.Do(context.Background(), CompleteEventInput{
		TutorID: uuid.New(), EventID: uuid.New(), SessionNote: "x",
	}); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

// ── ListEventsForTutor ───────────────────────────────────────────

func TestListEventsForTutor_PassesThrough(t *testing.T) {
	t.Parallel()
	tutorID := uuid.New()
	repo := fakeEventRepo{
		listTutor: func(_ context.Context, t uuid.UUID, l int) ([]domain.Event, error) {
			if t != tutorID || l != 25 {
				return nil, errors.New("args mismatch")
			}
			return []domain.Event{{Title: "ok"}, {Title: "ok2"}}, nil
		},
	}
	uc := &ListEventsForTutor{Repo: repo}
	out, err := uc.Do(context.Background(), tutorID, 25, "")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.Items) != 2 {
		t.Errorf("expected 2 events, got %d", len(out.Items))
	}
}

func TestListEventsForTutor_RejectsZeroID(t *testing.T) {
	t.Parallel()
	uc := &ListEventsForTutor{Repo: fakeEventRepo{}}
	if _, err := uc.Do(context.Background(), uuid.Nil, 10, ""); err == nil {
		t.Error("expected error for zero tutor id")
	}
}

// ── ListUpcomingEventsForStudent ─────────────────────────────────

func TestListUpcomingEventsForStudent_PassesThrough(t *testing.T) {
	t.Parallel()
	studentID := uuid.New()
	frozen := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	repo := fakeEventRepo{
		listStudent: func(_ context.Context, s uuid.UUID, now time.Time, _ int) ([]domain.Event, error) {
			if s != studentID || !now.Equal(frozen) {
				return nil, errors.New("args mismatch")
			}
			return []domain.Event{{Title: "next"}}, nil
		},
	}
	uc := &ListUpcomingEventsForStudent{Repo: repo, Now: func() time.Time { return frozen }}
	out, err := uc.Do(context.Background(), studentID, 5, "")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.Items) != 1 {
		t.Errorf("expected 1 event, got %d", len(out.Items))
	}
}
