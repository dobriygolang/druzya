package app

import (
	"context"
	"errors"
	"testing"

	"druz9/profile/domain"
	"druz9/profile/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestGetProfile_Do_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	bundle := domain.Bundle{
		User: domain.User{ID: uid, Username: "alice"},
		Profile: domain.Profile{
			UserID: uid, Level: 3, XP: 100, CharClass: enums.CharClassNovice,
		},
		Subscription: domain.Subscription{Plan: enums.SubscriptionPlanFree},
		AICredits:    5,
		Ratings: []domain.SectionRating{
			{Section: enums.SectionAlgorithms, Elo: 1500},
		},
	}
	repo.EXPECT().GetByUserID(gomock.Any(), uid).Return(bundle, nil)

	uc := &GetProfile{Repo: repo}
	v, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if v.GlobalPowerScore == 0 {
		t.Fatal("expected GlobalPowerScore to be derived")
	}
	if v.XPToNext != domain.XPToNext(3) {
		t.Fatalf("XPToNext mismatch: got %d, want %d", v.XPToNext, domain.XPToNext(3))
	}
	if v.Bundle.User.Username != "alice" {
		t.Fatalf("bundle user not propagated")
	}
}

func TestGetProfile_Do_NotFoundPropagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{}, domain.ErrNotFound)

	uc := &GetProfile{Repo: repo}
	_, err := uc.Do(context.Background(), uid)
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound (wrapped), got %v", err)
	}
}

func TestGetProfile_Do_UnknownErrorWrapped(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	wantErr := errors.New("pg conn refused")
	repo.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{}, wantErr)

	uc := &GetProfile{Repo: repo}
	_, err := uc.Do(context.Background(), uid)
	if !errors.Is(err, wantErr) {
		t.Fatalf("error should wrap upstream; got %v", err)
	}
	// Wrapping must contain a tracing prefix for grep-debugging.
	if got := err.Error(); len(got) == 0 || got == wantErr.Error() {
		t.Fatalf("expected wrapping prefix, got bare %q", got)
	}
}

func TestGetPublic_Do_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	pub := domain.PublicBundle{
		User:    domain.User{ID: uid, Username: "bob"},
		Profile: domain.Profile{UserID: uid, Level: 2},
		Ratings: []domain.SectionRating{
			{Section: enums.SectionGo, Elo: 1700},
		},
	}
	repo.EXPECT().GetPublic(gomock.Any(), "bob").Return(pub, nil)

	uc := &GetPublic{Repo: repo}
	v, err := uc.Do(context.Background(), "bob")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if v.GlobalPowerScore == 0 {
		t.Fatal("expected derived score")
	}
}

func TestGetPublic_Do_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	repo.EXPECT().GetPublic(gomock.Any(), "ghost").Return(domain.PublicBundle{}, domain.ErrNotFound)

	uc := &GetPublic{Repo: repo}
	_, err := uc.Do(context.Background(), "ghost")
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}
