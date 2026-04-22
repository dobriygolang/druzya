package ports

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"druz9/profile/app"
	"druz9/profile/domain"
	"druz9/profile/domain/mocks"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// silentLogger keeps test output clean.
func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newTestServer(t *testing.T, repo domain.ProfileRepo) *ProfileServer {
	t.Helper()
	h := NewHandler(Handler{
		GetProfile:     &app.GetProfile{Repo: repo},
		GetPublic:      &app.GetPublic{Repo: repo},
		GetAtlas:       &app.GetAtlas{Repo: repo},
		GetReport:      &app.GetReport{Repo: repo},
		GetSettings:    &app.GetSettings{Repo: repo},
		UpdateSettings: &app.UpdateSettings{Repo: repo},
		Log:            silentLogger(),
	})
	return NewProfileServer(h)
}

func TestGetMyProfile_UnauthenticatedWhenNoUserID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	srv := newTestServer(t, repo)

	_, err := srv.GetMyProfile(context.Background(), connect.NewRequest(&pb.GetMyProfileRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

func TestGetMyProfile_NotFoundMappedToCodeNotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{}, domain.ErrNotFound)

	srv := newTestServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)

	_, err := srv.GetMyProfile(ctx, connect.NewRequest(&pb.GetMyProfileRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestGetMyProfile_InternalErrorScrubbed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{}, errors.New("pg down"))

	srv := newTestServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)

	_, err := srv.GetMyProfile(ctx, connect.NewRequest(&pb.GetMyProfileRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInternal {
		t.Fatalf("expected Internal, got %v", err)
	}
	// The user-facing message must NOT leak the upstream error.
	if msg := ce.Message(); msg == "pg down" {
		t.Fatalf("expected scrubbed message, got %q", msg)
	}
}

func TestGetMyProfile_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{
		User:    domain.User{ID: uid, Username: "alice"},
		Profile: domain.Profile{UserID: uid, Level: 2, XP: 50},
	}, nil)

	srv := newTestServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)

	resp, err := srv.GetMyProfile(ctx, connect.NewRequest(&pb.GetMyProfileRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetUsername() != "alice" {
		t.Fatalf("got %+v", resp.Msg)
	}
	if resp.Msg.GetLevel() != 2 {
		t.Fatalf("level mismatch: %d", resp.Msg.GetLevel())
	}
}

func TestGetPublicProfile_EmptyUsernameInvalid(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	srv := newTestServer(t, repo)

	_, err := srv.GetPublicProfile(context.Background(),
		connect.NewRequest(&pb.GetPublicProfileRequest{Username: ""}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestGetPublicProfile_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	repo.EXPECT().GetPublic(gomock.Any(), "ghost").Return(domain.PublicBundle{}, domain.ErrNotFound)

	srv := newTestServer(t, repo)
	_, err := srv.GetPublicProfile(context.Background(),
		connect.NewRequest(&pb.GetPublicProfileRequest{Username: "ghost"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestGetPublicProfile_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().GetPublic(gomock.Any(), "bob").Return(domain.PublicBundle{
		User:    domain.User{ID: uid, Username: "bob"},
		Profile: domain.Profile{UserID: uid, Level: 7},
	}, nil)

	srv := newTestServer(t, repo)
	resp, err := srv.GetPublicProfile(context.Background(),
		connect.NewRequest(&pb.GetPublicProfileRequest{Username: "bob"}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetUsername() != "bob" || resp.Msg.GetLevel() != 7 {
		t.Fatalf("got %+v", resp.Msg)
	}
}

func TestUpdateSettings_RequiresAuth(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	srv := newTestServer(t, repo)

	_, err := srv.UpdateSettings(context.Background(),
		connect.NewRequest(&pb.UpdateProfileSettingsRequest{Settings: &pb.ProfileSettings{}}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

func TestUpdateSettings_NilSettingsInvalidArgument(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	srv := newTestServer(t, repo)

	ctx := sharedMw.WithUserID(context.Background(), uuid.New())
	_, err := srv.UpdateSettings(ctx,
		connect.NewRequest(&pb.UpdateProfileSettingsRequest{Settings: nil}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}
