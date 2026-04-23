package app

import (
	"context"
	"errors"
	"testing"

	"druz9/profile/domain"
	"druz9/profile/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestUpdateSettings_RoundTripsOnboardingAndFocusClass(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()

	in := domain.Settings{
		HasOnboardingCompleted: true,
		OnboardingCompleted:    true,
		HasFocusClass:          true,
		FocusClass:             "backend",
	}
	repo.EXPECT().UpdateSettings(gomock.Any(), uid, gomock.AssignableToTypeOf(domain.Settings{})).
		DoAndReturn(func(_ context.Context, _ uuid.UUID, s domain.Settings) error {
			if !s.HasFocusClass || s.FocusClass != "backend" {
				t.Fatalf("focus_class not propagated: %+v", s)
			}
			if !s.HasOnboardingCompleted || !s.OnboardingCompleted {
				t.Fatalf("onboarding flag not propagated: %+v", s)
			}
			return nil
		})
	repo.EXPECT().GetSettings(gomock.Any(), uid).Return(domain.Settings{
		OnboardingCompleted: true,
		FocusClass:          "backend",
	}, nil)

	uc := &UpdateSettings{Repo: repo}
	out, err := uc.Do(context.Background(), uid, in)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if !out.OnboardingCompleted || out.FocusClass != "backend" {
		t.Fatalf("round-trip mismatch: %+v", out)
	}
}

func TestUpdateSettings_InvalidFocusClassRejected(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	// Repo MUST NOT be called — validation happens before persistence.
	uc := &UpdateSettings{Repo: repo}
	_, err := uc.Do(context.Background(), uid, domain.Settings{
		HasFocusClass: true,
		FocusClass:    "wizard", // not in AllowedFocusClasses
	})
	if err == nil {
		t.Fatal("expected validation error for unknown focus_class")
	}
}

func TestUpdateSettings_PartialUpdateSkipsFocusClass(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	// Caller updates display_name only — HasFocusClass false, so no
	// validation and the repo receives HasFocusClass=false (postgres
	// SQL will then leave the column untouched).
	repo.EXPECT().UpdateSettings(gomock.Any(), uid, gomock.AssignableToTypeOf(domain.Settings{})).
		DoAndReturn(func(_ context.Context, _ uuid.UUID, s domain.Settings) error {
			if s.HasFocusClass {
				t.Fatalf("HasFocusClass must be false on partial update")
			}
			return nil
		})
	repo.EXPECT().GetSettings(gomock.Any(), uid).Return(domain.Settings{
		DisplayName: "Sergey",
		FocusClass:  "algo", // pre-existing, untouched
	}, nil)

	uc := &UpdateSettings{Repo: repo}
	out, err := uc.Do(context.Background(), uid, domain.Settings{DisplayName: "Sergey"})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.FocusClass != "algo" {
		t.Fatalf("expected pre-existing focus_class preserved, got %q", out.FocusClass)
	}
}

func TestUpdateSettings_PersistFailurePropagated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().UpdateSettings(gomock.Any(), uid, gomock.Any()).Return(errors.New("pg blew up"))
	uc := &UpdateSettings{Repo: repo}
	if _, err := uc.Do(context.Background(), uid, domain.Settings{}); err == nil {
		t.Fatal("expected propagated repo error")
	}
}
