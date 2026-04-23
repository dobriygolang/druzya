// Package ports test suite for GuildServer + the bare TopGuildsHandler REST
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

	"druz9/guild/app"
	"druz9/guild/domain"
	"druz9/guild/domain/mocks"
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

// newTestServer wires a GuildServer over the supplied mock repos.
func newTestServer(_ *testing.T, guilds domain.GuildRepo, wars domain.WarRepo) *GuildServer {
	clock := fixedClock{t: time.Date(2026, 4, 22, 12, 0, 0, 0, time.UTC)}
	my := &app.GetMyGuild{Guilds: guilds, Wars: wars, Clock: clock}
	get := &app.GetGuild{Guilds: guilds, Wars: wars, Clock: clock}
	war := &app.GetWar{Guilds: guilds, Wars: wars, Clock: clock}
	contribute := &app.Contribute{Guilds: guilds, Wars: wars, GetWar: war, Clock: clock}
	top := &app.ListTopGuilds{Guilds: guilds}
	return NewGuildServer(my, get, war, contribute, top, silentLogger())
}

// ── GetMyGuild ────────────────────────────────────────────────────────────

func TestGuildServer_GetMyGuild_Unauthenticated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	srv := newTestServer(t, guilds, wars)

	_, err := srv.GetMyGuild(context.Background(), connect.NewRequest(&pb.GetMyGuildRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

// TestGuildServer_GetMyGuild_NotFound — Wave-13 sanctum-bug fix: when the
// user has no guild, GetMyGuild now returns OK with an empty Guild proto
// (id == "") instead of Connect NotFound. This kills the noisy 404 log on
// /sanctum for fresh accounts. Frontend treats id=="" as "no guild yet".
func TestGuildServer_GetMyGuild_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	uid := uuid.New()
	guilds.EXPECT().GetMyGuild(gomock.Any(), uid).Return(domain.Guild{}, domain.ErrNotFound)

	srv := newTestServer(t, guilds, wars)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyGuild(ctx, connect.NewRequest(&pb.GetMyGuildRequest{}))
	if err != nil {
		t.Fatalf("expected nil err, got %v", err)
	}
	if resp == nil || resp.Msg == nil {
		t.Fatal("expected non-nil response")
	}
	if resp.Msg.GetId() != "" {
		t.Fatalf("expected empty Guild envelope (id==\"\"), got id=%q", resp.Msg.GetId())
	}
}

func TestGuildServer_GetMyGuild_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	uid := uuid.New()
	gid := uuid.New()
	guilds.EXPECT().GetMyGuild(gomock.Any(), uid).Return(domain.Guild{ID: gid, Name: "ironclad", GuildElo: 1500}, nil)
	guilds.EXPECT().ListGuildMembers(gomock.Any(), gid).Return([]domain.Member{
		{UserID: uid, GuildID: gid, Username: "alice", Role: domain.RoleCaptain, JoinedAt: time.Now().UTC()},
	}, nil)
	wars.EXPECT().GetCurrentWarForGuild(gomock.Any(), gid, gomock.Any()).Return(domain.War{}, domain.ErrNotFound)

	srv := newTestServer(t, guilds, wars)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetMyGuild(ctx, connect.NewRequest(&pb.GetMyGuildRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetName() != "ironclad" || resp.Msg.GetGuildElo() != 1500 {
		t.Fatalf("response mismatch: %+v", resp.Msg)
	}
	if got := len(resp.Msg.GetMembers()); got != 1 {
		t.Fatalf("expected 1 member, got %d", got)
	}
	if got := resp.Msg.GetCurrentWarId(); got != "" {
		t.Fatalf("no active war → empty current_war_id, got %q", got)
	}
}

// ── GetGuild ──────────────────────────────────────────────────────────────

func TestGuildServer_GetGuild_InvalidUUID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	srv := newTestServer(t, guilds, wars)
	_, err := srv.GetGuild(context.Background(), connect.NewRequest(&pb.GetGuildRequest{GuildId: "not-a-uuid"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestGuildServer_GetGuild_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	gid := uuid.New()
	guilds.EXPECT().GetGuild(gomock.Any(), gid).Return(domain.Guild{}, domain.ErrNotFound)

	srv := newTestServer(t, guilds, wars)
	_, err := srv.GetGuild(context.Background(), connect.NewRequest(&pb.GetGuildRequest{GuildId: gid.String()}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestGuildServer_GetGuild_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	gid := uuid.New()
	guilds.EXPECT().GetGuild(gomock.Any(), gid).Return(domain.Guild{ID: gid, Name: "phoenix", GuildElo: 1700}, nil)
	guilds.EXPECT().ListGuildMembers(gomock.Any(), gid).Return(nil, nil)
	wars.EXPECT().GetCurrentWarForGuild(gomock.Any(), gid, gomock.Any()).Return(domain.War{}, domain.ErrNotFound)

	srv := newTestServer(t, guilds, wars)
	resp, err := srv.GetGuild(context.Background(), connect.NewRequest(&pb.GetGuildRequest{GuildId: gid.String()}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetName() != "phoenix" {
		t.Fatalf("expected phoenix, got %q", resp.Msg.GetName())
	}
}

// ── GetWar ────────────────────────────────────────────────────────────────

func TestGuildServer_GetWar_InvalidUUID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	srv := newTestServer(t, guilds, wars)
	_, err := srv.GetWar(context.Background(), connect.NewRequest(&pb.GetGuildWarRequest{GuildId: "garbage"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestGuildServer_GetWar_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	guilds := mocks.NewMockGuildRepo(ctrl)
	wars := mocks.NewMockWarRepo(ctrl)
	gid := uuid.New()
	wars.EXPECT().GetCurrentWarForGuild(gomock.Any(), gid, gomock.Any()).Return(domain.War{}, domain.ErrNotFound)

	srv := newTestServer(t, guilds, wars)
	_, err := srv.GetWar(context.Background(), connect.NewRequest(&pb.GetGuildWarRequest{GuildId: gid.String()}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

// ── ListTopGuilds (Connect-RPC) ────────────────────────────────────────────
//
// Раньше это был отдельный TopGuildsHandler (chi-route). После перевода в
// Connect-RPC тесты вызывают метод server напрямую через connect.NewRequest.

func TestListTopGuilds_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGuildRepo(ctrl)
	id1, id2 := uuid.New(), uuid.New()
	repo.EXPECT().ListTopGuilds(gomock.Any(), 5).Return([]domain.TopGuildSummary{
		{GuildID: id1, Name: "alpha", Emblem: "shield", MembersCount: 10, EloTotal: 1900, WarsWon: 4, Rank: 1},
		{GuildID: id2, Name: "beta", Emblem: "sword", MembersCount: 7, EloTotal: 1700, WarsWon: 2, Rank: 2},
	}, nil)

	srv := newTestServer(t, repo, nil)
	resp, err := srv.ListTopGuilds(context.Background(), connect.NewRequest(&pb.ListTopGuildsRequest{Limit: 5}))
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(resp.Msg.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(resp.Msg.Items))
	}
	if resp.Msg.Items[0].Name != "alpha" || resp.Msg.Items[0].EloTotal != 1900 || resp.Msg.Items[0].Rank != 1 {
		t.Fatalf("first item mismatch: %+v", resp.Msg.Items[0])
	}
	if resp.Msg.Items[0].GuildId != id1.String() {
		t.Fatalf("uuid mismatch: %q vs %q", resp.Msg.Items[0].GuildId, id1.String())
	}
}

func TestListTopGuilds_Empty(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGuildRepo(ctrl)
	repo.EXPECT().ListTopGuilds(gomock.Any(), domain.DefaultTopGuildsLimit).Return(nil, nil)

	srv := newTestServer(t, repo, nil)
	resp, err := srv.ListTopGuilds(context.Background(), connect.NewRequest(&pb.ListTopGuildsRequest{}))
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

func TestListTopGuilds_LimitClampHigh(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGuildRepo(ctrl)
	repo.EXPECT().ListTopGuilds(gomock.Any(), domain.MaxTopGuildsLimit).Return(nil, nil)

	srv := newTestServer(t, repo, nil)
	if _, err := srv.ListTopGuilds(context.Background(), connect.NewRequest(&pb.ListTopGuildsRequest{Limit: 9999})); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestListTopGuilds_LimitClampLow(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGuildRepo(ctrl)
	repo.EXPECT().ListTopGuilds(gomock.Any(), domain.DefaultTopGuildsLimit).Return(nil, nil)

	srv := newTestServer(t, repo, nil)
	if _, err := srv.ListTopGuilds(context.Background(), connect.NewRequest(&pb.ListTopGuildsRequest{Limit: -1})); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestListTopGuilds_RepoErrorScrubbed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGuildRepo(ctrl)
	repo.EXPECT().ListTopGuilds(gomock.Any(), gomock.Any()).Return(nil, errors.New("pg connection dropped"))

	srv := newTestServer(t, repo, nil)
	_, err := srv.ListTopGuilds(context.Background(), connect.NewRequest(&pb.ListTopGuildsRequest{}))
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
	if errors.Is(err, errors.New("pg connection dropped")) {
		t.Fatalf("body leaked upstream error: %v", err)
	}
}
