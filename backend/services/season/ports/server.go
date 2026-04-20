// Package ports exposes the season domain via Connect-RPC.
//
// SeasonServer implements druz9v1connect.SeasonServiceHandler (generated from
// proto/druz9/v1/season.proto). Mounted in main.go via NewSeasonServiceHandler
// + vanguard — the same handler serves /druz9.v1.SeasonService/GetCurrent
// natively and GET /api/v1/season/current via REST transcoding.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"druz9/season/app"
	"druz9/season/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — SeasonServer satisfies the generated handler.
var _ druz9v1connect.SeasonServiceHandler = (*SeasonServer)(nil)

// SeasonServer adapts season use cases to Connect.
//
// Field name uses the `UC` suffix to avoid collisions with the generated
// method name `GetCurrent`.
type SeasonServer struct {
	GetCurrentUC *app.GetCurrent
	Log          *slog.Logger
}

// NewSeasonServer wires a SeasonServer.
func NewSeasonServer(uc *app.GetCurrent, log *slog.Logger) *SeasonServer {
	return &SeasonServer{GetCurrentUC: uc, Log: log}
}

// GetCurrent implements druz9.v1.SeasonService/GetCurrent.
func (s *SeasonServer) GetCurrent(
	ctx context.Context,
	_ *connect.Request[pb.GetCurrentSeasonRequest],
) (*connect.Response[pb.SeasonProgress], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	view, err := s.GetCurrentUC.Do(ctx, uid)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toSeasonProgressProto(view)), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *SeasonServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNoCurrent), errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		if s.Log != nil {
			s.Log.Error("season: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("season failure"))
	}
}

// ── converter (app → proto) ───────────────────────────────────────────────

func toSeasonProgressProto(v app.SeasonView) *pb.SeasonProgress {
	out := &pb.SeasonProgress{
		Season: &pb.SeasonHeader{
			Id:   v.Season.ID.String(),
			Name: v.Season.Name,
			Slug: v.Season.Slug,
		},
		MyPoints:  int32(v.MyPoints),
		Tier:      int32(v.Tier),
		IsPremium: v.IsPremium,
	}
	if !v.Season.StartsAt.IsZero() {
		out.Season.StartsAt = timestamppb.New(v.Season.StartsAt.UTC())
	}
	if !v.Season.EndsAt.IsZero() {
		out.Season.EndsAt = timestamppb.New(v.Season.EndsAt.UTC())
	}

	for _, tr := range v.Tracks {
		protoTrack := &pb.SeasonTrack{Kind: string(tr.Kind)}
		for _, ti := range tr.Tiers {
			protoTrack.Tiers = append(protoTrack.Tiers, &pb.SeasonTier{
				Tier:           int32(ti.Tier),
				RequiredPoints: int32(ti.RequiredPoints),
				RewardKey:      ti.RewardKey,
				Claimed:        ti.Claimed,
			})
		}
		out.Tracks = append(out.Tracks, protoTrack)
	}

	for _, c := range v.WeeklyChallenges {
		out.WeeklyChallenges = append(out.WeeklyChallenges, &pb.SeasonWeeklyChallenge{
			Key:          c.Key,
			Title:        c.Title,
			Progress:     int32(c.Progress),
			Target:       int32(c.Target),
			PointsReward: int32(c.PointsReward),
		})
	}
	return out
}
