package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

type fakeUserRepo struct {
	banCalls   int
	unbanCalls int
	listCalls  int
	getCalls   int
	user       domain.AdminUserRow
	page       domain.UserPage
	banErr     error
	unbanErr   error
}

func (f *fakeUserRepo) List(_ context.Context, _ domain.UserListFilter) (domain.UserPage, error) {
	f.listCalls++
	return f.page, nil
}

func (f *fakeUserRepo) Get(_ context.Context, _ uuid.UUID) (domain.AdminUserRow, error) {
	f.getCalls++
	return f.user, nil
}

func (f *fakeUserRepo) Ban(_ context.Context, in domain.BanInput) (domain.AdminUserRow, error) {
	f.banCalls++
	if f.banErr != nil {
		return domain.AdminUserRow{}, f.banErr
	}
	return domain.AdminUserRow{
		ID: in.UserID, Username: f.user.Username,
		IsBanned: true, BanReason: in.Reason, BanExpiresAt: in.ExpiresAt,
	}, nil
}

func (f *fakeUserRepo) Unban(_ context.Context, _, _ uuid.UUID) (domain.AdminUserRow, error) {
	f.unbanCalls++
	if f.unbanErr != nil {
		return domain.AdminUserRow{}, f.unbanErr
	}
	return domain.AdminUserRow{ID: f.user.ID, Username: f.user.Username, IsBanned: false}, nil
}

func TestBanUser_Do_Success(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	repo := &fakeUserRepo{user: domain.AdminUserRow{ID: uid, Username: "alice"}}
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
	if repo.banCalls != 1 {
		t.Fatalf("ban should be called once, got %d", repo.banCalls)
	}
}

func TestBanUser_Do_RejectsBlankReason(t *testing.T) {
	t.Parallel()
	uc := &BanUser{Users: &fakeUserRepo{}}
	_, err := uc.Do(context.Background(), BanInput{
		UserID: uuid.New(), Reason: "   ",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("blank reason must fail with ErrInvalidInput, got %v", err)
	}
}

func TestBanUser_Do_RejectsZeroUUID(t *testing.T) {
	t.Parallel()
	uc := &BanUser{Users: &fakeUserRepo{}}
	if _, err := uc.Do(context.Background(), BanInput{Reason: "x"}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("nil user_id must fail, got %v", err)
	}
}

func TestBanUser_Do_RejectsLongReason(t *testing.T) {
	t.Parallel()
	uc := &BanUser{Users: &fakeUserRepo{}}
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
	past := time.Now().Add(-time.Hour)
	uc := &BanUser{Users: &fakeUserRepo{}}
	_, err := uc.Do(context.Background(), BanInput{
		UserID: uuid.New(), Reason: "x", ExpiresAt: &past,
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("past expires_at must fail, got %v", err)
	}
}

func TestBanUser_Do_PropagatesAlreadyBanned(t *testing.T) {
	t.Parallel()
	repo := &fakeUserRepo{
		user:   domain.AdminUserRow{ID: uuid.New()},
		banErr: domain.ErrAlreadyBanned,
	}
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
	repo := &fakeUserRepo{user: domain.AdminUserRow{ID: uuid.New(), Username: "bob"}}
	uc := &UnbanUser{Users: repo}
	out, err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.IsBanned {
		t.Fatal("expected IsBanned=false")
	}
	if repo.unbanCalls != 1 {
		t.Fatalf("unban should be called once, got %d", repo.unbanCalls)
	}
}

func TestUnbanUser_Do_PropagatesNotBanned(t *testing.T) {
	t.Parallel()
	repo := &fakeUserRepo{
		user:     domain.AdminUserRow{ID: uuid.New()},
		unbanErr: domain.ErrNotBanned,
	}
	uc := &UnbanUser{Users: repo}
	_, err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, domain.ErrNotBanned) {
		t.Fatalf("expected ErrNotBanned, got %v", err)
	}
}
