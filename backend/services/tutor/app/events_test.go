package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/tutor/domain"
	"druz9/tutor/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── CreateEvent ───────────────────────────────────────────────────

func TestCreateEvent_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	studentID := uuid.New()
	future := time.Now().Add(2 * time.Hour)

	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), tutorID, studentID).Return(nil)
	repo.EXPECT().CreateEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, e domain.Event) (domain.Event, error) {
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
	)
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
	if out.Title != "Weekly 1-on-1" || out.BodyMD != "Bring questions about ch.4" {
		t.Errorf("input not trimmed: %+v", out)
	}
	if out.MeetURL != "https://meet.example.com/abc" {
		t.Errorf("meet_url not trimmed: %q", out.MeetURL)
	}
}

func TestCreateEvent_RejectsBadInput(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	// No EXPECT — ensure must not be called for bad input.
	uc := &CreateEvent{Repo: mocks.NewMockEventRepo(ctrl)}
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
// support «we're starting in a moment» flow.
func TestCreateEvent_AcceptsNowIshScheduling(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tutorID, studentID := uuid.New(), uuid.New()
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil)
	repo.EXPECT().CreateEvent(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, e domain.Event) (domain.Event, error) {
			e.ID = uuid.New()
			return e, nil
		},
	)
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().EnsureRelationship(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrNotFound)
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
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	eventID := uuid.New()
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().CancelEvent(gomock.Any(), tutorID, eventID, "Sick today", gomock.Any()).Return(nil)
	uc := &CancelEvent{Repo: repo}
	if err := uc.Do(context.Background(), CancelEventInput{
		TutorID: tutorID, EventID: eventID, Reason: "  Sick today  ",
	}); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestCancelEvent_RejectsBadInput(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &CancelEvent{Repo: mocks.NewMockEventRepo(ctrl)}
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().CancelEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrInvalidInput)
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
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	eventID := uuid.New()
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().CompleteEvent(gomock.Any(), tutorID, eventID, "Covered ch.4 + chunking", gomock.Any()).Return(nil)
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
	ctrl := gomock.NewController(t)
	uc := &CompleteEvent{Repo: mocks.NewMockEventRepo(ctrl)}
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().CompleteEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrInvalidInput)
	uc := &CompleteEvent{Repo: repo}
	if err := uc.Do(context.Background(), CompleteEventInput{
		TutorID: uuid.New(), EventID: uuid.New(), SessionNote: "x",
	}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Errorf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCompleteEvent_NotFoundPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().CompleteEvent(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrNotFound)
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
	ctrl := gomock.NewController(t)
	tutorID := uuid.New()
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().ListByTutorPaged(gomock.Any(), tutorID, 25, gomock.Any()).Return(
		[]domain.Event{{Title: "ok"}, {Title: "ok2"}}, "", nil,
	)
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
	ctrl := gomock.NewController(t)
	uc := &ListEventsForTutor{Repo: mocks.NewMockEventRepo(ctrl)}
	if _, err := uc.Do(context.Background(), uuid.Nil, 10, ""); err == nil {
		t.Error("expected error for zero tutor id")
	}
}

// ── ListUpcomingEventsForStudent ─────────────────────────────────

func TestListUpcomingEventsForStudent_PassesThrough(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	studentID := uuid.New()
	frozen := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	repo := mocks.NewMockEventRepo(ctrl)
	repo.EXPECT().ListUpcomingForStudentPaged(gomock.Any(), studentID, frozen, gomock.Any(), gomock.Any()).Return(
		[]domain.Event{{Title: "next"}}, "", nil,
	)
	uc := &ListUpcomingEventsForStudent{Repo: repo, Now: func() time.Time { return frozen }}
	out, err := uc.Do(context.Background(), studentID, 5, "")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.Items) != 1 {
		t.Errorf("expected 1 event, got %d", len(out.Items))
	}
}
