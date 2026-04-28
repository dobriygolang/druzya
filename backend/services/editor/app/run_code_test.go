package app_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/editor/app"
	"druz9/editor/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// fakeRoomRepo / fakeParticipantRepo — minimal stubs.
type fakeRoomRepo struct{ room domain.Room }

func (r *fakeRoomRepo) Create(_ context.Context, _ domain.Room) (domain.Room, error) {
	return domain.Room{}, nil
}
func (r *fakeRoomRepo) Get(_ context.Context, _ uuid.UUID) (domain.Room, error) {
	return r.room, nil
}
func (r *fakeRoomRepo) UpdateFreeze(_ context.Context, _ uuid.UUID, _ bool) (domain.Room, error) {
	return domain.Room{}, nil
}
func (r *fakeRoomRepo) ExtendExpires(_ context.Context, _ uuid.UUID, _ time.Time) error { return nil }
func (r *fakeRoomRepo) SetVisibility(_ context.Context, _ uuid.UUID, _ domain.Visibility) error {
	return nil
}
func (r *fakeRoomRepo) DeleteOwned(_ context.Context, _, _ uuid.UUID) error { return nil }

type fakeParticipants struct{ list []domain.Participant }

func (p *fakeParticipants) Add(_ context.Context, _ domain.Participant) (domain.Participant, error) {
	return domain.Participant{}, nil
}
func (p *fakeParticipants) List(_ context.Context, _ uuid.UUID) ([]domain.Participant, error) {
	return p.list, nil
}
func (p *fakeParticipants) GetRole(_ context.Context, _, _ uuid.UUID) (enums.EditorRole, error) {
	return "", nil
}

type fakeRunner struct{ called int }

func (r *fakeRunner) Run(_ context.Context, _ string, _ enums.Language) (domain.RunResult, error) {
	r.called++
	return domain.RunResult{Stdout: "ok"}, nil
}

func TestRunCode_RejectsUnsupportedLanguage(t *testing.T) {
	t.Parallel()
	owner := uuid.New()
	uc := &app.RunCode{
		Rooms:        &fakeRoomRepo{room: domain.Room{ID: uuid.New(), OwnerID: owner, Language: enums.LanguageGo}},
		Participants: &fakeParticipants{},
		Runner:       &fakeRunner{},
	}
	_, err := uc.Do(context.Background(), app.RunCodeInput{
		RoomID:   uuid.New(),
		CallerID: owner,
		Code:     "SELECT 1",
		Language: enums.LanguageSQL,
	})
	if !errors.Is(err, domain.ErrLanguageUnsupported) {
		t.Fatalf("err = %v, want ErrLanguageUnsupported", err)
	}
}

func TestRunCode_HitsRunnerForAllowedLanguage(t *testing.T) {
	t.Parallel()
	owner := uuid.New()
	runner := &fakeRunner{}
	uc := &app.RunCode{
		Rooms:        &fakeRoomRepo{room: domain.Room{ID: uuid.New(), OwnerID: owner, Language: enums.LanguageGo}},
		Participants: &fakeParticipants{},
		Runner:       runner,
	}
	_, err := uc.Do(context.Background(), app.RunCodeInput{
		RoomID:   uuid.New(),
		CallerID: owner,
		Code:     "package main",
		Language: enums.LanguageGo,
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if runner.called != 1 {
		t.Fatalf("runner.called = %d, want 1", runner.called)
	}
}

func TestUserRateLimiter_BurstAndExhaust(t *testing.T) {
	t.Parallel()
	lim := app.NewUserRateLimiter(3, time.Minute)
	uid := uuid.New()
	for i := 0; i < 3; i++ {
		ok, _, err := lim.Allow(context.Background(), uid)
		if err != nil || !ok {
			t.Fatalf("burst %d: ok=%v err=%v", i, ok, err)
		}
	}
	ok, retry, err := lim.Allow(context.Background(), uid)
	if err != nil {
		t.Fatalf("4th: err=%v", err)
	}
	if ok {
		t.Fatalf("4th call should be denied")
	}
	if retry <= 0 {
		t.Fatalf("retryAfterSec should be positive, got %d", retry)
	}
}

func TestRunCode_RateLimitedFromLimiter(t *testing.T) {
	t.Parallel()
	owner := uuid.New()
	uc := &app.RunCode{
		Rooms:        &fakeRoomRepo{room: domain.Room{ID: uuid.New(), OwnerID: owner, Language: enums.LanguageGo}},
		Participants: &fakeParticipants{},
		Runner:       &fakeRunner{},
		Limiter:      app.NewUserRateLimiter(1, time.Minute),
	}
	in := app.RunCodeInput{RoomID: uuid.New(), CallerID: owner, Code: "x", Language: enums.LanguageGo}
	if _, err := uc.Do(context.Background(), in); err != nil {
		t.Fatalf("first call: %v", err)
	}
	_, err := uc.Do(context.Background(), in)
	if !errors.Is(err, domain.ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited", err)
	}
}
