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
		Repo:           repo,
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

// stubReportFetcher records the userID and returns a canned view.
type stubReportFetcher struct {
	gotUID uuid.UUID
	view   app.ReportView
	err    error
}

func (s *stubReportFetcher) Get(_ context.Context, uid uuid.UUID) (app.ReportView, error) {
	s.gotUID = uid
	return s.view, s.err
}

func TestGetMyReport_PrefersReportFetcher(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	fetcher := &stubReportFetcher{view: app.ReportView{StreakDays: 9, BestStreak: 14}}
	h := NewHandler(Handler{
		GetReport:     &app.GetReport{Repo: repo}, // not called
		ReportFetcher: fetcher,
		Log:           silentLogger(),
	})
	srv := NewProfileServer(h)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyReport(ctx, connect.NewRequest(&pb.GetMyReportRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetStreakDays() != 9 {
		t.Fatalf("streak not propagated: %d", resp.Msg.GetStreakDays())
	}
	if fetcher.gotUID != uid {
		t.Fatalf("uid mismatch: got %s want %s", fetcher.gotUID, uid)
	}
}

func TestGetMyReport_FetcherErrorMappedToInternal(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	fetcher := &stubReportFetcher{err: errors.New("boom")}
	h := NewHandler(Handler{
		ReportFetcher: fetcher,
		Log:           silentLogger(),
	})
	srv := NewProfileServer(h)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetMyReport(ctx, connect.NewRequest(&pb.GetMyReportRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInternal {
		t.Fatalf("expected Internal, got %v", err)
	}
}

// TestGetMyProfile_EmailExposed asserts that ProfileFull surfaces users.email
// so the /settings page can stop hard-coding it. Email may be empty for
// Telegram-login users without a verified address.
func TestGetMyProfile_EmailExposed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().GetByUserID(gomock.Any(), uid).Return(domain.Bundle{
		User:    domain.User{ID: uid, Username: "alice", Email: "alice@example.com"},
		Profile: domain.Profile{UserID: uid, Level: 1},
	}, nil)
	srv := newTestServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyProfile(ctx, connect.NewRequest(&pb.GetMyProfileRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetEmail() != "alice@example.com" {
		t.Fatalf("expected email surfaced, got %q", resp.Msg.GetEmail())
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

// ── GetWeeklyShare (Phase C public share link) ──────────────────────────────

func TestGetWeeklyShare_EmptyTokenInvalid(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	srv := newTestServer(t, repo)

	_, err := srv.GetWeeklyShare(context.Background(),
		connect.NewRequest(&pb.GetWeeklyShareRequest{Token: ""}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestGetWeeklyShare_TokenNotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	repo.EXPECT().ResolveShareToken(gomock.Any(), "missing").
		Return(domain.ShareResolution{}, domain.ErrNotFound)

	srv := newTestServer(t, repo)
	_, err := srv.GetWeeklyShare(context.Background(),
		connect.NewRequest(&pb.GetWeeklyShareRequest{Token: "missing"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

// TestGetWeeklyShare_ExpiredMappedToNotFound — у нас infra/postgres.go
// возвращает domain.ErrNotFound и для протухшего, и для отсутствующего
// токена (UPDATE … WHERE expires_at > now() RETURNING). Здесь имитируем
// тот же контракт.
func TestGetWeeklyShare_ExpiredMappedToNotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	repo.EXPECT().ResolveShareToken(gomock.Any(), "expired").
		Return(domain.ShareResolution{}, domain.ErrNotFound)

	srv := newTestServer(t, repo)
	_, err := srv.GetWeeklyShare(context.Background(),
		connect.NewRequest(&pb.GetWeeklyShareRequest{Token: "expired"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestGetWeeklyShare_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().ResolveShareToken(gomock.Any(), "abc123").
		Return(domain.ShareResolution{UserID: uid, WeekISO: "2026-W17"}, nil)
	// GetReport.Do делает 4 запроса; пустой Activity + nil-ошибки на остальных
	// → отчёт деградирует, но запрос проходит.
	repo.EXPECT().CountRecentActivity(gomock.Any(), uid, gomock.Any()).
		Return(domain.Activity{XPEarned: 100, MatchesWon: 3}, nil)
	repo.EXPECT().ListMatchAggregatesSince(gomock.Any(), uid, gomock.Any()).
		Return(nil, errors.New("ignored"))
	repo.EXPECT().ListWeeklyXPSince(gomock.Any(), uid, gomock.Any(), 4).
		Return(nil, errors.New("ignored"))
	repo.EXPECT().GetStreaks(gomock.Any(), uid).
		Return(0, 0, errors.New("ignored"))

	srv := newTestServer(t, repo)
	resp, err := srv.GetWeeklyShare(context.Background(),
		connect.NewRequest(&pb.GetWeeklyShareRequest{Token: "abc123"}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetShareToken() != "abc123" {
		t.Fatalf("expected token echoed, got %q", resp.Msg.GetShareToken())
	}
	if resp.Msg.GetMetrics().GetXpEarned() != 100 {
		t.Fatalf("expected metrics propagated, got %+v", resp.Msg.GetMetrics())
	}
}

// TestGetMyReport_IssuesShareTokenWhenRequested — кнопка «Поделиться»
// на /weekly: фронт делает повторный запрос с include_share_token=true,
// бэк выпускает токен и кладёт его в ответ.
func TestGetMyReport_IssuesShareTokenWhenRequested(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	fetcher := &stubReportFetcher{view: app.ReportView{}}
	repo.EXPECT().IssueShareToken(gomock.Any(), uid, gomock.Any()).
		Return(domain.ShareToken{Token: "freshtoken"}, nil)
	h := NewHandler(Handler{
		GetReport:     &app.GetReport{Repo: repo},
		ReportFetcher: fetcher,
		Repo:          repo,
		Log:           silentLogger(),
	})
	srv := NewProfileServer(h)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyReport(ctx,
		connect.NewRequest(&pb.GetMyReportRequest{IncludeShareToken: true}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetShareToken() != "freshtoken" {
		t.Fatalf("expected token issued, got %q", resp.Msg.GetShareToken())
	}
}

// TestGetMyReport_TokenIssueFailureDoesNotFailRequest — если IssueShareToken
// упал (например, сеть БД дёрнулась), основной отчёт всё равно отдаётся.
func TestGetMyReport_TokenIssueFailureDoesNotFailRequest(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	fetcher := &stubReportFetcher{view: app.ReportView{}}
	repo.EXPECT().IssueShareToken(gomock.Any(), uid, gomock.Any()).
		Return(domain.ShareToken{}, errors.New("db down"))
	h := NewHandler(Handler{
		GetReport:     &app.GetReport{Repo: repo},
		ReportFetcher: fetcher,
		Repo:          repo,
		Log:           silentLogger(),
	})
	srv := NewProfileServer(h)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyReport(ctx,
		connect.NewRequest(&pb.GetMyReportRequest{IncludeShareToken: true}))
	if err != nil {
		t.Fatalf("expected success despite token failure: %v", err)
	}
	if resp.Msg.GetShareToken() != "" {
		t.Fatalf("expected empty token on issue failure, got %q", resp.Msg.GetShareToken())
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
