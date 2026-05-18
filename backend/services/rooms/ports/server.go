// Package ports exposes the RoomService Connect-RPC server.
package ports

import (
	"context"
	"errors"
	"fmt"

	"druz9/rooms/app"
	"druz9/rooms/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type RoomServer struct {
	Create  *app.CreateRoom
	List    *app.ListMyRooms
	Extend  *app.ExtendRoom
	Delete  *app.DeleteRoom
	Restore *app.RestoreRoom
	Quota   domain.QuotaRepo
}

func NewRoomServer(s RoomServer) *RoomServer { return &s }

func (s *RoomServer) CreateStandaloneRoom(
	ctx context.Context,
	req *connect.Request[pb.CreateStandaloneRoomRequest],
) (*connect.Response[pb.CreateStandaloneRoomResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	kind := domain.Kind(req.Msg.GetKind())
	if !kind.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid kind"))
	}
	out, err := s.Create.Do(ctx, app.CreateRoomInput{
		UserID: uid, Kind: kind, Title: req.Msg.GetTitle(),
	})
	if err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.CreateStandaloneRoomResponse{
		Room: toProtoRoom(out.Room, out.ShareURL),
	}), nil
}

func (s *RoomServer) ListMyRooms(
	ctx context.Context,
	req *connect.Request[pb.ListMyRoomsRequest],
) (*connect.Response[pb.ListMyRoomsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	status := domain.StatusActive
	switch req.Msg.GetStatus() {
	case "past":
		status = domain.StatusPast
	case "all":
		status = domain.StatusAll
	}
	rooms, err := s.List.Do(ctx, uid, status)
	if err != nil {
		return nil, toConnectErr(err)
	}
	q, _ := s.Quota.Get(ctx, uid)
	resp := &pb.ListMyRoomsResponse{
		Rooms: make([]*pb.Room, 0, len(rooms)),
		Quota: &pb.RoomQuota{
			ActiveCount: int32(q.ActiveCount),
			MaxActive:   int32(domain.FreeMaxActive),
			Tier:        q.Tier,
		},
	}
	for _, r := range rooms {
		resp.Rooms = append(resp.Rooms, toProtoRoom(r, ""))
	}
	return connect.NewResponse(resp), nil
}

func (s *RoomServer) ExtendRoom(
	ctx context.Context,
	req *connect.Request[pb.ExtendRoomRequest],
) (*connect.Response[pb.ExtendRoomResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, perr)
	}
	if err := s.Extend.Do(ctx, uid, domain.Kind(req.Msg.GetKind()), id, int(req.Msg.GetHours())); err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.ExtendRoomResponse{}), nil
}

func (s *RoomServer) DeleteRoom(
	ctx context.Context,
	req *connect.Request[pb.DeleteRoomRequest],
) (*connect.Response[pb.DeleteRoomResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, perr)
	}
	if err := s.Delete.Do(ctx, uid, domain.Kind(req.Msg.GetKind()), id); err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.DeleteRoomResponse{}), nil
}

func (s *RoomServer) RestoreRoom(
	ctx context.Context,
	req *connect.Request[pb.RestoreRoomRequest],
) (*connect.Response[pb.RestoreRoomResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, perr)
	}
	if err := s.Restore.Do(ctx, uid, domain.Kind(req.Msg.GetKind()), id); err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.RestoreRoomResponse{}), nil
}

func toProtoRoom(r domain.Room, shareURL string) *pb.Room {
	out := &pb.Room{
		Id:         r.ID.String(),
		OwnerId:    r.OwnerID.String(),
		Kind:       string(r.Kind),
		Title:      r.Title,
		Visibility: r.Visibility,
		FreeTier:   r.FreeTier,
		ExpiresAt:  timestamppb.New(r.ExpiresAt),
		CreatedAt:  timestamppb.New(r.CreatedAt),
		ShareUrl:   shareURL,
	}
	if r.ArchivedAt != nil {
		out.ArchivedAt = timestamppb.New(*r.ArchivedAt)
	}
	return out
}

func requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrInvalidKind):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrQuotaExceeded):
		return connect.NewError(connect.CodeResourceExhausted, err)
	case errors.Is(err, domain.ErrNotOwner):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrProRequired):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, domain.ErrUserBlocked):
		return connect.NewError(connect.CodePermissionDenied, err)
	}
	return connect.NewError(connect.CodeInternal, fmt.Errorf("rooms: %w", err))
}
