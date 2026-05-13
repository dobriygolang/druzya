package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/admin/domain"
	"druz9/admin/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestBanUser_Do_Success(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	repo := mocks.NewMockUserRepo(ctrl)
	repo.EXPECT().Ban(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.BanInput) (domain.AdminUserRow, error) {
			return domain.AdminUserRow{
				ID: in.UserID, Username: "alice",
				IsBanned: true, BanReason: in.Reason, BanExpiresAt: in.ExpiresAt,
			}, nil
		},
	).Times(1)
	uc := &BanUser{Users: repo}
	out, err := uc.Do(context.Background(), BanInput{
		UserID: uid, Reason: "spam", IssuedBy: uuid.New(),
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if !out.IsBanned {
		t.Fatal("expected IsBanned=true")
	}
}

func TestBanUser_Do_RejectsBlankReason(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &BanUser{Users: mocks.NewMockUserRepo(ctrl)}
	_, err := uc.Do(context.Background(), BanInput{
		UserID: uuid.New(), Reason: "   ",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("blank reason must fail with ErrInvalidInput, got %v", err)
	}
}

func TestBanUser_Do_RejectsZeroUUID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &BanUser{Users: mocks.NewMockUserRepo(ctrl)}
	if _, err := uc.Do(context.Background(), BanInput{Reason: "x"}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("nil user_id must fail, got %v", err)
	}
}

func TestBanUser_Do_RejectsLongReason(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &BanUser{Users: mocks.NewMockUserRepo(ctrl)}
	_, err := uc.Do(context.Background(), BanInput{
		UserID: uuid.New(),
		Reason: strings.Repeat("x", MaxBanReasonLen+1),
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("oversize reason must fail, got %v", err)
	}
}

func TestBanUser_Do_RejectsExpiresInPast(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	past := time.Now().Add(-time.Hour)
	uc := &BanUser{Users: mocks.NewMockUserRepo(ctrl)}
	_, err := uc.Do(context.Background(), BanInput{
		UserID: uuid.New(), Reason: "x", ExpiresAt: &past,
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("past expires_at must fail, got %v", err)
	}
}

func TestBanUser_Do_PropagatesAlreadyBanned(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockUserRepo(ctrl)
	repo.EXPECT().Ban(gomock.Any(), gomock.Any()).Return(domain.AdminUserRow{}, domain.ErrAlreadyBanned)
	uc := &BanUser{Users: repo}
	_, err := uc.Do(context.Background(), BanInput{
		UserID: uuid.New(), Reason: "x",
	})
	if !errors.Is(err, domain.ErrAlreadyBanned) {
		t.Fatalf("expected ErrAlreadyBanned passthrough, got %v", err)
	}
}

func TestUnbanUser_Do_Success(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	repo := mocks.NewMockUserRepo(ctrl)
	repo.EXPECT().Unban(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.AdminUserRow{ID: uid, Username: "bob", IsBanned: false}, nil,
	).Times(1)
	uc := &UnbanUser{Users: repo}
	out, err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.IsBanned {
		t.Fatal("expected IsBanned=false")
	}
}

func TestUnbanUser_Do_PropagatesNotBanned(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockUserRepo(ctrl)
	repo.EXPECT().Unban(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.AdminUserRow{}, domain.ErrNotBanned)
	uc := &UnbanUser{Users: repo}
	_, err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, domain.ErrNotBanned) {
		t.Fatalf("expected ErrNotBanned, got %v", err)
	}
}
