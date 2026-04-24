// Package ports test suite for CohortServer + the bare TopCohortsHandler REST
// shim. Mirrors profile/ports/server_test.go (Phase 1) and
// rating/ports/server_test.go (Phase 2): direct method calls on the server
// with mock repos and an explicit user-id context.
package ports

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/cohort/app"
	"druz9/cohort/domain"
	"druz9/cohort/domain/mocks"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fixedClock satisfies domain.Clock with a constant instant. Inline here to
// avoid pulling the domain test package into ports.
type fixedClock struct{ t time.Time }

func (c fixedClock) Now() time.Time { return c.t }

// newTestServer wires a CohortServer over the supplied mock repos.
func newTestServer(_ *testing.T, cohorts domain.CohortRepo, wars domain.WarRepo) *CohortServer {
	clock := fixedClock{t: time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC)}
	my := &app.GetMyCohort{Cohorts: cohorts, Wars: wars, Clock: clock}
	get := &app.GetCohort{Cohorts: cohorts, Wars: wars, Clock: clock}
	war := &app.GetWar{Cohorts: cohorts, Wars: wars, Clock: clock}
	contribute := &app.Contribute{Cohorts: cohorts, Wars: wars, GetWar: war, Clock: clock}
	top := &app.ListTopCohorts{Cohorts: cohorts}
	return NewCohortServer(my, get, war, contribute, top, silentLogger())
}

// ── GetMyCohort ────────────────────────────────────────────────────────────

func TestCohortServer_GetMyCohort_Unauthenticated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	srv := newTestServer(t, cohorts, wars)

	_, err := srv.GetMyCohort(context.Background(), connect.NewRequest(&pb.GetMyCohortRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

// TestCohortServer_GetMyCohort_NotFound — Wave-13 sanctum-bug fix: when the
// user has no cohort, GetMyCohort now returns OK with an empty Cohort proto
// (id == "") instead of Connect NotFound. This kills the noisy 404 log on
// /sanctum for fresh accounts. Frontend treats id=="" as "no cohort yet".
func TestCohortServer_GetMyCohort_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	uid := uuid.New()
	cohorts.EXPECT().GetMyCohort(gomock.Any(), uid).Return(domain.Cohort{}, domain.ErrNotFound)

	srv := newTestServer(t, cohorts, wars)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyCohort(ctx, connect.NewRequest(&pb.GetMyCohortRequest{}))
	if err != nil {
		t.Fatalf("expected nil err, got %v", err)
	}
	if resp == nil || resp.Msg == nil {
		t.Fatal("expected non-nil response")
	}
	if resp.Msg.GetId() != "" {
		t.Fatalf("expected empty Cohort envelope (id==\"\"), got id=%q", resp.Msg.GetId())
	}
}

func TestCohortServer_GetMyCohort_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	uid := uuid.New()
	gid := uuid.New()
	cohorts.EXPECT().GetMyCohort(gomock.Any(), uid).Return(domain.Cohort{ID: gid, Name: "ironclad", CohortElo: 1500}, nil)
	cohorts.EXPECT().ListCohortMembers(gomock.Any(), gid).Return([]domain.Member{
		{UserID: uid, CohortID: gid, Username: "alice", Role: domain.RoleCaptain, JoinedAt: time.Now().UTC()},
	}, nil)
	wars.EXPECT().GetCurrentWarForCohort(gomock.Any(), gid, gomock.Any()).Return(domain.War{}, domain.ErrNotFound)

	srv := newTestServer(t, cohorts, wars)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyCohort(ctx, connect.NewRequest(&pb.GetMyCohortRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetName() != "ironclad" || resp.Msg.GetCohortElo() != 1500 {
		t.Fatalf("response mismatch: %+v", resp.Msg)
	}
	if got := len(resp.Msg.GetMembers()); got != 1 {
		t.Fatalf("expected 1 member, got %d", got)
	}
	if got := resp.Msg.GetCurrentWarId(); got != "" {
		t.Fatalf("no active war → empty current_war_id, got %q", got)
	}
}

// ── GetCohort ──────────────────────────────────────────────────────────────

func TestCohortServer_GetCohort_InvalidUUID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	srv := newTestServer(t, cohorts, wars)
	_, err := srv.GetCohort(context.Background(), connect.NewRequest(&pb.GetCohortRequest{CohortId: "not-a-uuid"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestCohortServer_GetCohort_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	gid := uuid.New()
	cohorts.EXPECT().GetCohort(gomock.Any(), gid).Return(domain.Cohort{}, domain.ErrNotFound)

	srv := newTestServer(t, cohorts, wars)
	_, err := srv.GetCohort(context.Background(), connect.NewRequest(&pb.GetCohortRequest{CohortId: gid.String()}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestCohortServer_GetCohort_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	gid := uuid.New()
	cohorts.EXPECT().GetCohort(gomock.Any(), gid).Return(domain.Cohort{ID: gid, Name: "phoenix", CohortElo: 1700}, nil)
	cohorts.EXPECT().ListCohortMembers(gomock.Any(), gid).Return(nil, nil)
	wars.EXPECT().GetCurrentWarForCohort(gomock.Any(), gid, gomock.Any()).Return(domain.War{}, domain.ErrNotFound)

	srv := newTestServer(t, cohorts, wars)
	resp, err := srv.GetCohort(context.Background(), connect.NewRequest(&pb.GetCohortRequest{CohortId: gid.String()}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetName() != "phoenix" {
		t.Fatalf("expected phoenix, got %q", resp.Msg.GetName())
	}
}

// ── GetWar ────────────────────────────────────────────────────────────────

func TestCohortServer_GetWar_InvalidUUID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	srv := newTestServer(t, cohorts, wars)
	_, err := srv.GetWar(context.Background(), connect.NewRequest(&pb.GetCohortWarRequest{CohortId: "garbage"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestCohortServer_GetWar_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cohorts := mocks.NewMockCohortRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	gid := uuid.New()
	wars.EXPECT().GetCurrentWarForCohort(gomock.Any(), gid, gomock.Any()).Return(domain.War{}, domain.ErrNotFound)

	srv := newTestServer(t, cohorts, wars)
	_, err := srv.GetWar(context.Background(), connect.NewRequest(&pb.GetCohortWarRequest{CohortId: gid.String()}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

// ── ListTopCohorts (Connect-RPC) ────────────────────────────────────────────
//
// Раньше это был отдельный TopCohortsHandler (chi-route). После перевода в
// Connect-RPC тесты вызывают метод server напрямую через connect.NewRequest.

func TestListTopCohorts_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockCohortRepo(ctrl)
	id1, id2 := uuid.New(), uuid.New()
	repo.EXPECT().ListTopCohorts(gomock.Any(), 5).Return([]domain.TopCohortSummary{
		{CohortID: id1, Name: "alpha", Emblem: "shield", MembersCount: 10, EloTotal: 1900, WarsWon: 4, Rank: 1},
		{CohortID: id2, Name: "beta", Emblem: "sword", MembersCount: 7, EloTotal: 1700, WarsWon: 2, Rank: 2},
	}, nil)

	srv := newTestServer(t, repo, nil)
	resp, err := srv.ListTopCohorts(context.Background(), connect.NewRequest(&pb.ListTopCohortsRequest{Limit: 5}))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(resp.Msg.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(resp.Msg.Items))
	}
	if resp.Msg.Items[0].Name != "alpha" || resp.Msg.Items[0].EloTotal != 1900 || resp.Msg.Items[0].Rank != 1 {
		t.Fatalf("first item mismatch: %+v", resp.Msg.Items[0])
	}
	if resp.Msg.Items[0].CohortId != id1.String() {
		t.Fatalf("uuid mismatch: %q vs %q", resp.Msg.Items[0].CohortId, id1.String())
	}
}

func TestListTopCohorts_Empty(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockCohortRepo(ctrl)
	repo.EXPECT().ListTopCohorts(gomock.Any(), domain.DefaultTopCohortsLimit).Return(nil, nil)

	srv := newTestServer(t, repo, nil)
	resp, err := srv.ListTopCohorts(context.Background(), connect.NewRequest(&pb.ListTopCohortsRequest{}))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if resp.Msg.Items == nil {
		t.Fatalf("expected non-nil empty slice, got nil")
	}
	if len(resp.Msg.Items) != 0 {
		t.Fatalf("expected empty, got %d", len(resp.Msg.Items))
	}
}

func TestListTopCohorts_LimitClampHigh(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockCohortRepo(ctrl)
	repo.EXPECT().ListTopCohorts(gomock.Any(), domain.MaxTopCohortsLimit).Return(nil, nil)

	srv := newTestServer(t, repo, nil)
	if _, err := srv.ListTopCohorts(context.Background(), connect.NewRequest(&pb.ListTopCohortsRequest{Limit: 9999})); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestListTopCohorts_LimitClampLow(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockCohortRepo(ctrl)
	repo.EXPECT().ListTopCohorts(gomock.Any(), domain.DefaultTopCohortsLimit).Return(nil, nil)

	srv := newTestServer(t, repo, nil)
	if _, err := srv.ListTopCohorts(context.Background(), connect.NewRequest(&pb.ListTopCohortsRequest{Limit: -1})); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestListTopCohorts_RepoErrorScrubbed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockCohortRepo(ctrl)
	repo.EXPECT().ListTopCohorts(gomock.Any(), gomock.Any()).Return(nil, errors.New("pg connection dropped"))

	srv := newTestServer(t, repo, nil)
	_, err := srv.ListTopCohorts(context.Background(), connect.NewRequest(&pb.ListTopCohortsRequest{}))
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if errors.Is(err, errors.New("pg connection dropped")) {
		t.Fatalf("body leaked upstream error: %v", err)
	}
}
