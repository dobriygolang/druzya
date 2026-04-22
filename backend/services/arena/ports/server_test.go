// Package ports — RPC handler tests for ArenaServer.
//
// We exercise the Connect-RPC handlers via direct method calls (no HTTP
// wire), injecting a real *ArenaServer wired to mock repos. Coverage
// focuses on the shapes the transcoded REST layer relies on:
//
//   - missing user-id in context → CodeUnauthenticated (every endpoint)
//   - invalid match-id / section / mode → CodeInvalidArgument
//   - domain.ErrNotFound → CodeNotFound
//   - non-participant → CodePermissionDenied (GetMatch)
//   - happy path → 200 with the right proto fields
package ports

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/arena/app"
	"druz9/arena/domain"
	"druz9/arena/domain/mocks"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// silentLog returns an io.Discard-backed logger so test runs stay quiet.
func silentLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// The use cases under test (FindMatch, CancelSearch, GetMatch) do not use
// the Bus or any other heavy collaborator. SubmitCode/ConfirmReady do —
// those paths are exercised by the use-case-level service_test.go suite.

// newServer wires an ArenaServer with the mocks the test wants exercised.
// Anything that's not relevant for a given test is left nil to surface
// "use of nil pointer" if a test accidentally exercises that code path.
func newServer(t *testing.T) (*ArenaServer, *mocks.MockMatchRepo, *mocks.MockTaskRepo, *mocks.MockQueueRepo) {
	t.Helper()
	ctrl := gomock.NewController(t)
	matches := mocks.NewMockMatchRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	queue := mocks.NewMockQueueRepo(ctrl)

	srv := &ArenaServer{
		Find:   &app.FindMatch{Queue: queue, Clock: domain.RealClock{}},
		Cancel: &app.CancelSearch{Queue: queue},
		Get:    &app.GetMatch{Matches: matches, Tasks: tasks},
		// Confirm/Submit/Timeouts left nil — tests that need them set up
		// their own server instance.
		Log: silentLog(),
	}
	return srv, matches, tasks, queue
}

// ── auth gate ────────────────────────────────────────────────────────────

func TestFindMatch_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv, _, _, _ := newServer(t)
	_, err := srv.FindMatch(context.Background(), connect.NewRequest(&pb.FindMatchRequest{
		Section: pb.Section_SECTION_ALGORITHMS,
		Mode:    pb.ArenaMode_ARENA_MODE_SOLO_1V1,
	}))
	assertConnectCode(t, err, connect.CodeUnauthenticated)
}

func TestCancelSearch_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv, _, _, _ := newServer(t)
	_, err := srv.CancelSearch(context.Background(), connect.NewRequest(&pb.CancelMatchRequest{}))
	assertConnectCode(t, err, connect.CodeUnauthenticated)
}

func TestGetMatch_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv, _, _, _ := newServer(t)
	_, err := srv.GetMatch(context.Background(), connect.NewRequest(&pb.GetMatchRequest{
		MatchId: uuid.NewString(),
	}))
	assertConnectCode(t, err, connect.CodeUnauthenticated)
}

// ── invalid input ────────────────────────────────────────────────────────

func TestFindMatch_InvalidSection(t *testing.T) {
	t.Parallel()
	srv, _, _, _ := newServer(t)
	ctx := sharedMw.WithUserID(context.Background(), uuid.New())
	_, err := srv.FindMatch(ctx, connect.NewRequest(&pb.FindMatchRequest{
		Section: pb.Section_SECTION_UNSPECIFIED, // → ""
		Mode:    pb.ArenaMode_ARENA_MODE_SOLO_1V1,
	}))
	assertConnectCode(t, err, connect.CodeInvalidArgument)
}

func TestFindMatch_InvalidMode(t *testing.T) {
	t.Parallel()
	srv, _, _, _ := newServer(t)
	ctx := sharedMw.WithUserID(context.Background(), uuid.New())
	_, err := srv.FindMatch(ctx, connect.NewRequest(&pb.FindMatchRequest{
		Section: pb.Section_SECTION_ALGORITHMS,
		Mode:    pb.ArenaMode_ARENA_MODE_UNSPECIFIED,
	}))
	assertConnectCode(t, err, connect.CodeInvalidArgument)
}

func TestGetMatch_InvalidMatchID(t *testing.T) {
	t.Parallel()
	srv, _, _, _ := newServer(t)
	ctx := sharedMw.WithUserID(context.Background(), uuid.New())
	_, err := srv.GetMatch(ctx, connect.NewRequest(&pb.GetMatchRequest{
		MatchId: "not-a-uuid",
	}))
	assertConnectCode(t, err, connect.CodeInvalidArgument)
}

// ── domain error mapping ─────────────────────────────────────────────────

func TestGetMatch_NotFoundMappedToCodeNotFound(t *testing.T) {
	t.Parallel()
	srv, matches, _, _ := newServer(t)
	uid := uuid.New()
	mid := uuid.New()
	matches.EXPECT().Get(gomock.Any(), mid).Return(domain.Match{}, domain.ErrNotFound)

	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetMatch(ctx, connect.NewRequest(&pb.GetMatchRequest{MatchId: mid.String()}))
	assertConnectCode(t, err, connect.CodeNotFound)
}

func TestGetMatch_NonParticipantForbidden(t *testing.T) {
	t.Parallel()
	srv, matches, tasks, _ := newServer(t)
	uid := uuid.New()
	other := uuid.New()
	mid := uuid.New()
	tid := uuid.New()
	matches.EXPECT().Get(gomock.Any(), mid).Return(domain.Match{
		ID:     mid,
		TaskID: tid,
		Status: enums.MatchStatusActive,
	}, nil)
	matches.EXPECT().ListParticipants(gomock.Any(), mid).Return([]domain.Participant{
		{UserID: other, Team: 0, EloBefore: 1000},
	}, nil)
	tasks.EXPECT().GetByID(gomock.Any(), tid).Return(domain.TaskPublic{ID: tid, Title: "x"}, nil).AnyTimes()

	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetMatch(ctx, connect.NewRequest(&pb.GetMatchRequest{MatchId: mid.String()}))
	assertConnectCode(t, err, connect.CodePermissionDenied)
}

// ── happy paths ──────────────────────────────────────────────────────────

func TestFindMatch_HappyPath_Queued(t *testing.T) {
	t.Parallel()
	srv, _, _, queue := newServer(t)
	uid := uuid.New()
	queue.EXPECT().Enqueue(gomock.Any(), gomock.Any()).Return(nil)
	queue.EXPECT().Position(gomock.Any(), uid, enums.SectionAlgorithms, enums.ArenaModeSolo1v1).Return(3, nil)

	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.FindMatch(ctx, connect.NewRequest(&pb.FindMatchRequest{
		Section: pb.Section_SECTION_ALGORITHMS,
		Mode:    pb.ArenaMode_ARENA_MODE_SOLO_1V1,
	}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetStatus() != "queued" {
		t.Fatalf("status=%q", resp.Msg.GetStatus())
	}
	if resp.Msg.GetQueuePosition() != 3 {
		t.Fatalf("position=%d", resp.Msg.GetQueuePosition())
	}
	// 5s per person ahead × (3-1) = 10s.
	if resp.Msg.GetEstimatedWaitSec() != 10 {
		t.Fatalf("est=%d", resp.Msg.GetEstimatedWaitSec())
	}
}

func TestCancelSearch_HappyPath(t *testing.T) {
	t.Parallel()
	srv, _, _, queue := newServer(t)
	uid := uuid.New()
	// CancelSearch sweeps every (section × mode) — accept any call.
	queue.EXPECT().Remove(gomock.Any(), uid, gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	ctx := sharedMw.WithUserID(context.Background(), uid)
	if _, err := srv.CancelSearch(ctx, connect.NewRequest(&pb.CancelMatchRequest{})); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestGetMatch_HappyPath(t *testing.T) {
	t.Parallel()
	srv, matches, tasks, _ := newServer(t)
	uid := uuid.New()
	mid := uuid.New()
	tid := uuid.New()
	started := time.Now().UTC()
	matches.EXPECT().Get(gomock.Any(), mid).Return(domain.Match{
		ID:        mid,
		TaskID:    tid,
		Section:   enums.SectionAlgorithms,
		Mode:      enums.ArenaModeSolo1v1,
		Status:    enums.MatchStatusActive,
		StartedAt: &started,
	}, nil)
	matches.EXPECT().ListParticipants(gomock.Any(), mid).Return([]domain.Participant{
		{UserID: uid, Team: 0, EloBefore: 1100},
		{UserID: uuid.New(), Team: 1, EloBefore: 1080},
	}, nil)
	tasks.EXPECT().GetByID(gomock.Any(), tid).Return(domain.TaskPublic{
		ID: tid, Title: "Two Sum", Difficulty: enums.DifficultyEasy, Section: enums.SectionAlgorithms,
	}, nil)

	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMatch(ctx, connect.NewRequest(&pb.GetMatchRequest{MatchId: mid.String()}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetId() != mid.String() {
		t.Fatalf("id=%q", resp.Msg.GetId())
	}
	if got := resp.Msg.GetStatus(); got != pb.MatchStatus_MATCH_STATUS_ACTIVE {
		t.Fatalf("status=%v", got)
	}
	if len(resp.Msg.GetParticipants()) != 2 {
		t.Fatalf("participants=%d", len(resp.Msg.GetParticipants()))
	}
	if title := resp.Msg.GetTask().GetTitle(); title != "Two Sum" {
		t.Fatalf("title=%q", title)
	}
}

// ── enum coverage ────────────────────────────────────────────────────────
//
// These exercise the enum adapters that the proto layer relies on. They're
// cheap and catch silent breakage when a new variant is added to either side.

func TestEnumAdapters_RoundTripModes(t *testing.T) {
	t.Parallel()
	cases := []enums.ArenaMode{
		enums.ArenaModeSolo1v1, enums.ArenaModeRanked,
		enums.ArenaModeHardcore, enums.ArenaModeCursed, enums.ArenaModeDuo2v2,
	}
	for _, m := range cases {
		got := arenaModeFromProto(arenaModeToProto(m))
		if got != m {
			t.Fatalf("mode round-trip: want %q got %q", m, got)
		}
	}
}

func TestEnumAdapters_RoundTripSections(t *testing.T) {
	t.Parallel()
	for _, s := range enums.AllSections() {
		got := sectionFromProto(sectionToProto(s))
		if got != s {
			t.Fatalf("section round-trip: want %q got %q", s, got)
		}
	}
}

// assertConnectCode fails the test if err's connect code doesn't match.
func assertConnectCode(t *testing.T, err error, want connect.Code) {
	t.Helper()
	var ce *connect.Error
	if !errors.As(err, &ce) {
		t.Fatalf("expected connect error, got %v", err)
	}
	if ce.Code() != want {
		t.Fatalf("expected code %v, got %v (msg=%q)", want, ce.Code(), ce.Message())
	}
}
