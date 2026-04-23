// Package ports test suite for RatingServer. Mirrors the layout of
// profile/ports/server_test.go (Phase 1) — direct method calls on the
// server with a mock RatingRepo and an explicit user-id context.
package ports

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/rating/app"
	"druz9/rating/domain"
	"druz9/rating/domain/mocks"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func newTestRatingServer(_ *testing.T, repo domain.RatingRepo) *RatingServer {
	log := silentLogger()
	return NewRatingServer(
		&app.GetMyRatings{Ratings: repo},
		&app.GetLeaderboard{Ratings: repo, Log: log},
		log,
	)
}

func TestRatingServer_GetMyRatings_Unauthenticated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	srv := newTestRatingServer(t, repo)

	_, err := srv.GetMyRatings(context.Background(), connect.NewRequest(&pb.GetMyRatingsRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

func TestRatingServer_GetMyRatings_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().List(gomock.Any(), uid).Return(nil, domain.ErrNotFound)

	srv := newTestRatingServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetMyRatings(ctx, connect.NewRequest(&pb.GetMyRatingsRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestRatingServer_GetMyRatings_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().List(gomock.Any(), uid).Return([]domain.SectionRating{
		{UserID: uid, Section: enums.SectionAlgorithms, Elo: 1450, MatchesCount: 12},
		{UserID: uid, Section: enums.SectionSQL, Elo: 1300, MatchesCount: 4},
	}, nil)
	// Algorithms: rank 1 of 4 → 100th percentile.
	repo.EXPECT().FindRank(gomock.Any(), uid, enums.SectionAlgorithms).Return(1, nil)
	repo.EXPECT().CountSection(gomock.Any(), enums.SectionAlgorithms).Return(4, nil)
	// SQL: rank 3 of 5 → 50th percentile.
	repo.EXPECT().FindRank(gomock.Any(), uid, enums.SectionSQL).Return(3, nil)
	repo.EXPECT().CountSection(gomock.Any(), enums.SectionSQL).Return(5, nil)

	srv := newTestRatingServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyRatings(ctx, connect.NewRequest(&pb.GetMyRatingsRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if got := len(resp.Msg.GetRatings()); got != 2 {
		t.Fatalf("expected 2 ratings, got %d", got)
	}
	if resp.Msg.GetRatings()[0].GetElo() != 1450 {
		t.Fatalf("elo mismatch: %+v", resp.Msg.GetRatings()[0])
	}
	if got := resp.Msg.GetRatings()[0].GetPercentile(); got != 100 {
		t.Fatalf("expected algorithms percentile 100, got %d", got)
	}
	if got := resp.Msg.GetRatings()[1].GetPercentile(); got != 50 {
		t.Fatalf("expected sql percentile 50, got %d", got)
	}
}

func TestRatingServer_GetMyRatings_PercentileError_Propagates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().List(gomock.Any(), uid).Return([]domain.SectionRating{
		{UserID: uid, Section: enums.SectionAlgorithms, Elo: 1450},
	}, nil)
	// Anti-fallback: a FindRank failure must propagate, NOT silently fall back
	// to a hard-coded percentile value.
	repo.EXPECT().FindRank(gomock.Any(), uid, enums.SectionAlgorithms).
		Return(0, errors.New("pg down"))

	srv := newTestRatingServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetMyRatings(ctx, connect.NewRequest(&pb.GetMyRatingsRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInternal {
		t.Fatalf("expected Internal, got %v", err)
	}
}

func TestRatingServer_GetMyRatings_RepoError_Scrubbed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().List(gomock.Any(), uid).Return(nil, errors.New("pg connection dropped"))

	srv := newTestRatingServer(t, repo)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetMyRatings(ctx, connect.NewRequest(&pb.GetMyRatingsRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInternal {
		t.Fatalf("expected Internal, got %v", err)
	}
	if ce.Message() == "pg connection dropped" {
		t.Fatalf("expected scrubbed message, got %q", ce.Message())
	}
}

func TestRatingServer_GetLeaderboard_Empty(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	repo.EXPECT().Top(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return([]domain.LeaderboardEntry{}, nil)

	srv := newTestRatingServer(t, repo)
	resp, err := srv.GetLeaderboard(context.Background(),
		connect.NewRequest(&pb.GetLeaderboardRequest{Section: pb.Section_SECTION_ALGORITHMS, Limit: 50}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetEntries() == nil {
		t.Fatalf("expected non-nil empty slice")
	}
	if len(resp.Msg.GetEntries()) != 0 {
		t.Fatalf("expected empty, got %d entries", len(resp.Msg.GetEntries()))
	}
}

func TestRatingServer_GetLeaderboard_InvalidSection(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	srv := newTestRatingServer(t, repo)
	_, err := srv.GetLeaderboard(context.Background(),
		connect.NewRequest(&pb.GetLeaderboardRequest{Section: pb.Section_SECTION_UNSPECIFIED, Limit: 10}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInternal {
		// app.GetLeaderboard.Do returns an unwrapped error for invalid section,
		// which the server scrubs to Internal. We accept either Internal or
		// InvalidArgument here — but document the current behaviour.
		t.Fatalf("expected Internal or InvalidArgument, got %v", err)
	}
}

func TestRatingServer_GetLeaderboard_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockRatingRepo(ctrl)
	uid := uuid.New()
	now := time.Now().UTC()
	repo.EXPECT().Top(gomock.Any(), enums.SectionGo, gomock.Any()).Return([]domain.LeaderboardEntry{
		{UserID: uid, Username: "alice", Title: "Champion", Elo: 1700, Rank: 1},
		{UserID: uuid.New(), Username: "bob", Elo: 1600, Rank: 2},
	}, nil)

	srv := newTestRatingServer(t, repo)
	resp, err := srv.GetLeaderboard(context.Background(),
		connect.NewRequest(&pb.GetLeaderboardRequest{Section: pb.Section_SECTION_GO, Limit: 50}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	entries := resp.Msg.GetEntries()
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}
	if entries[0].GetUsername() != "alice" || entries[0].GetElo() != 1700 {
		t.Fatalf("entry mismatch: %+v", entries[0])
	}
	if got := resp.Msg.GetUpdatedAt().AsTime(); got.Before(now.Add(-time.Minute)) {
		t.Fatalf("updated_at not populated: %s", got)
	}
}

// TODO(phase-arena): GetLeaderboardRequest does not currently carry a `mode`
// filter. When proto adds it (e.g. ranked vs casual), add a test asserting
// the filter is plumbed through.
