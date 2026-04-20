// Package ports exposes the rating domain via Connect-RPC.
//
// RatingServer implements druz9v1connect.RatingServiceHandler (generated from
// proto/druz9/v1/rating.proto). It is mounted in main.go via
// NewRatingServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.RatingService/*) and the REST path
// (/api/v1/rating/*) declared via google.api.http annotations.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"druz9/rating/app"
	"druz9/rating/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — RatingServer satisfies the generated handler.
var _ druz9v1connect.RatingServiceHandler = (*RatingServer)(nil)

// RatingServer adapts rating use cases to the Connect handler interface.
type RatingServer struct {
	GetMyRatingsUC   *app.GetMyRatings
	GetLeaderboardUC *app.GetLeaderboard
	Log              *slog.Logger
}

// NewRatingServer wires a RatingServer.
func NewRatingServer(gm *app.GetMyRatings, gl *app.GetLeaderboard, log *slog.Logger) *RatingServer {
	return &RatingServer{GetMyRatingsUC: gm, GetLeaderboardUC: gl, Log: log}
}

// GetMyRatings implements druz9.v1.RatingService/GetMyRatings.
func (s *RatingServer) GetMyRatings(
	ctx context.Context,
	_ *connect.Request[pb.GetMyRatingsRequest],
) (*connect.Response[pb.GetMyRatingsResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	view, err := s.GetMyRatingsUC.Do(ctx, uid)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	ratings := make([]*pb.SectionRating, 0, len(view.Ratings))
	for _, sr := range view.Ratings {
		ratings = append(ratings, &pb.SectionRating{
			Section:      sectionFromString(sr.Section),
			Elo:          int32(sr.Elo),
			MatchesCount: int32(sr.MatchesCount),
			Percentile:   int32(sr.Percentile),
			Decaying:     sr.Decaying,
		})
	}
	// STUB: `history` is omitted until HistoryLast12Weeks is wired through the
	// use case. Mirrors the previous ports/server.go behaviour.
	return connect.NewResponse(&pb.GetMyRatingsResponse{
		Ratings:          ratings,
		GlobalPowerScore: int32(view.GlobalPowerScore),
	}), nil
}

// GetLeaderboard implements druz9.v1.RatingService/GetLeaderboard.
func (s *RatingServer) GetLeaderboard(
	ctx context.Context,
	req *connect.Request[pb.GetLeaderboardRequest],
) (*connect.Response[pb.GetLeaderboardResponse], error) {
	m := req.Msg
	section := sectionToString(m.Section)
	limit := int(m.Limit)
	if limit <= 0 {
		limit = 50
	}
	lb, err := s.GetLeaderboardUC.Do(ctx, section, limit)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	entries := make([]*pb.LeaderboardEntry, 0, len(lb.Entries))
	for _, e := range lb.Entries {
		entries = append(entries, &pb.LeaderboardEntry{
			Rank:     int32(e.Rank),
			UserId:   e.UserID.String(),
			Username: e.Username,
			Elo:      int32(e.Elo),
			Title:    e.Title,
		})
	}
	return connect.NewResponse(&pb.GetLeaderboardResponse{
		Section:   m.Section,
		UpdatedAt: timestamppb.New(lb.UpdatedAt.UTC()),
		MyRank:    int32(lb.MyRank),
		Entries:   entries,
	}), nil
}

// toConnectErr maps domain errors onto Connect error codes. Callers upstream
// (middleware, interceptors) translate these into HTTP status codes for REST
// clients transparently.
func (s *RatingServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		s.Log.Error("rating: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("rating failure"))
	}
}

// sectionFromString maps the string representation used inside app/ onto the
// generated Section enum. Keep in lock-step with shared/enums/section.go.
func sectionFromString(s string) pb.Section {
	switch s {
	case "algorithms":
		return pb.Section_SECTION_ALGORITHMS
	case "sql":
		return pb.Section_SECTION_SQL
	case "go":
		return pb.Section_SECTION_GO
	case "system_design":
		return pb.Section_SECTION_SYSTEM_DESIGN
	case "behavioral":
		return pb.Section_SECTION_BEHAVIORAL
	default:
		return pb.Section_SECTION_UNSPECIFIED
	}
}

// sectionToString is the inverse — app.GetLeaderboard.Do still takes a string
// keyed on shared/enums.Section values, so we translate back at the edge.
func sectionToString(s pb.Section) string {
	switch s {
	case pb.Section_SECTION_ALGORITHMS:
		return "algorithms"
	case pb.Section_SECTION_SQL:
		return "sql"
	case pb.Section_SECTION_GO:
		return "go"
	case pb.Section_SECTION_SYSTEM_DESIGN:
		return "system_design"
	case pb.Section_SECTION_BEHAVIORAL:
		return "behavioral"
	default:
		// An unspecified section keeps the app layer's validation responsibility:
		// the use case will reject it as "invalid section".
		return ""
	}
}

