// Package ports — Connect-RPC handlers for circles.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/circles/app"
	"druz9/circles/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var _ druz9v1connect.CirclesServiceHandler = (*CirclesServer)(nil)

type CirclesServer struct {
	H   *app.Handlers
	Log *slog.Logger
}

func NewCirclesServer(h *app.Handlers, log *slog.Logger) *CirclesServer {
	return &CirclesServer{H: h, Log: log}
}

func (s *CirclesServer) CreateCircle(
	ctx context.Context,
	req *connect.Request[pb.CreateCircleRequest],
) (*connect.Response[pb.Circle], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	full, err := s.H.CreateCircle(ctx, uid, req.Msg.GetName(), req.Msg.GetDescription())
	if err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(toCircleProto(full)), nil
}

func (s *CirclesServer) GetCircle(
	ctx context.Context,
	req *connect.Request[pb.GetCircleRequest],
) (*connect.Response[pb.Circle], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetCircleId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("circle_id: %w", err))
	}
	full, err := s.H.GetCircle(ctx, id, uid)
	if err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(toCircleProto(full)), nil
}

func (s *CirclesServer) ListMyCircles(
	ctx context.Context,
	_ *connect.Request[pb.ListMyCirclesRequest],
) (*connect.Response[pb.CircleList], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	circles, err := s.H.ListMyCircles(ctx, uid)
	if err != nil {
		return nil, s.toErr(err)
	}
	out := &pb.CircleList{Items: make([]*pb.Circle, 0, len(circles))}
	for _, c := range circles {
		out.Items = append(out.Items, &pb.Circle{
			Id:          c.ID.String(),
			Name:        c.Name,
			Description: c.Description,
			OwnerId:     c.OwnerID.String(),
			CreatedAt:   timestamppb.New(c.CreatedAt),
			UpdatedAt:   timestamppb.New(c.UpdatedAt),
		})
	}
	return connect.NewResponse(out), nil
}

func (s *CirclesServer) JoinCircle(
	ctx context.Context,
	req *connect.Request[pb.JoinCircleRequest],
) (*connect.Response[pb.CircleMutationResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetCircleId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("circle_id: %w", err))
	}
	if err := s.H.JoinCircle(ctx, id, uid); err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&pb.CircleMutationResponse{Ok: true}), nil
}

func (s *CirclesServer) LeaveCircle(
	ctx context.Context,
	req *connect.Request[pb.LeaveCircleRequest],
) (*connect.Response[pb.CircleMutationResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetCircleId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("circle_id: %w", err))
	}
	if err := s.H.LeaveCircle(ctx, id, uid); err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&pb.CircleMutationResponse{Ok: true}), nil
}

func (s *CirclesServer) DeleteCircle(
	ctx context.Context,
	req *connect.Request[pb.DeleteCircleRequest],
) (*connect.Response[pb.CircleMutationResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetCircleId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("circle_id: %w", err))
	}
	if err := s.H.DeleteCircle(ctx, id, uid); err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&pb.CircleMutationResponse{Ok: true}), nil
}

func toCircleProto(c app.CircleWithMembers) *pb.Circle {
	out := &pb.Circle{
		Id:          c.Circle.ID.String(),
		Name:        c.Circle.Name,
		Description: c.Circle.Description,
		OwnerId:     c.Circle.OwnerID.String(),
		MemberCount: int32(c.MemberCount),
		CreatedAt:   timestamppb.New(c.Circle.CreatedAt),
		UpdatedAt:   timestamppb.New(c.Circle.UpdatedAt),
	}
	for _, m := range c.Members {
		out.Members = append(out.Members, &pb.CircleMember{
			UserId:   m.UserID.String(),
			Username: m.Username,
			Role:     toCircleRoleProto(m.Role),
			JoinedAt: timestamppb.New(m.JoinedAt),
		})
	}
	return out
}

func toCircleRoleProto(r domain.Role) pb.CircleRole {
	switch r {
	case domain.RoleAdmin:
		return pb.CircleRole_CIRCLE_ROLE_ADMIN
	case domain.RoleMember:
		return pb.CircleRole_CIRCLE_ROLE_MEMBER
	default:
		return pb.CircleRole_CIRCLE_ROLE_UNSPECIFIED
	}
}

func (s *CirclesServer) toErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrConflict):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("circles: internal", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, err)
	}
}
