// discover_connect.go — Connect-RPC adapter for /circles/discover.
package ports

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

const discoverDefaultLimit = 30

func (s *CirclesServer) DiscoverCircles(
	ctx context.Context,
	req *connect.Request[pb.DiscoverCirclesRequest],
) (*connect.Response[pb.DiscoverCirclesResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	limit := int(req.Msg.Limit)
	if limit <= 0 {
		limit = discoverDefaultLimit
	}
	rows, err := s.H.ListDiscover(ctx, uid, limit)
	if err != nil {
		if s.Log != nil {
			s.Log.ErrorContext(ctx, "circles.DiscoverCircles", slog.Any("err", err))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.DiscoverCirclesResponse{Items: make([]*pb.DiscoverCircleItem, 0, len(rows))}
	for _, c := range rows {
		out.Items = append(out.Items, &pb.DiscoverCircleItem{
			Id:          c.ID.String(),
			Name:        c.Name,
			Description: c.Description,
			OwnerId:     c.OwnerID.String(),
			MemberCount: int32(c.MemberCount),
			CreatedAt:   c.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return connect.NewResponse(out), nil
}
