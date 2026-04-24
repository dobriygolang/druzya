// Package ports exposes the whiteboard_rooms domain via Connect-RPC.
//
// WhiteboardRoomsServer implements druz9v1connect.WhiteboardRoomsServiceHandler
// (generated from proto/druz9/v1/whiteboard_rooms.proto). Requires
// `make gen-proto` to be run after the .proto lands so the generated
// types/interface are available in druz9/shared/generated/pb/druz9/v1.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/whiteboard_rooms/app"
	"druz9/whiteboard_rooms/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — server must satisfy the generated handler.
var _ druz9v1connect.WhiteboardRoomsServiceHandler = (*WhiteboardRoomsServer)(nil)

// WhiteboardRoomsServer adapts use cases to Connect-RPC.
type WhiteboardRoomsServer struct {
	H     *app.Handlers
	WSURL func(roomID uuid.UUID) string
	Log   *slog.Logger
}

// NewWhiteboardRoomsServer wires a server. `wsURL` produces the WebSocket
// URL the client opens after the REST join — depends on the deployment
// (wss://druz9.online/ws/whiteboard/{id}) so it's injected from monolith.
func NewWhiteboardRoomsServer(h *app.Handlers, wsURL func(uuid.UUID) string, log *slog.Logger) *WhiteboardRoomsServer {
	return &WhiteboardRoomsServer{H: h, WSURL: wsURL, Log: log}
}

// CreateRoom implements WhiteboardRoomsService/CreateRoom.
func (s *WhiteboardRoomsServer) CreateRoom(
	ctx context.Context,
	req *connect.Request[pb.CreateWhiteboardRoomRequest],
) (*connect.Response[pb.WhiteboardRoom], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	room, err := s.H.CreateRoom(ctx, uid, req.Msg.GetTitle())
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(s.toProto(room, nil)), nil
}

// GetRoom implements WhiteboardRoomsService/GetRoom.
func (s *WhiteboardRoomsServer) GetRoom(
	ctx context.Context,
	req *connect.Request[pb.GetWhiteboardRoomRequest],
) (*connect.Response[pb.WhiteboardRoom], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	roomID, err := uuid.Parse(req.Msg.GetRoomId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid room_id: %w", err))
	}
	full, err := s.H.GetRoom(ctx, roomID, uid)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(s.toProto(full.Room, full.Participants)), nil
}

// ListMyRooms implements WhiteboardRoomsService/ListMyRooms.
func (s *WhiteboardRoomsServer) ListMyRooms(
	ctx context.Context,
	_ *connect.Request[pb.ListMyWhiteboardRoomsRequest],
) (*connect.Response[pb.WhiteboardRoomList], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	rooms, err := s.H.ListMyRooms(ctx, uid)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.WhiteboardRoomList{Items: make([]*pb.WhiteboardRoom, 0, len(rooms))}
	for _, r := range rooms {
		out.Items = append(out.Items, s.toProto(r, nil))
	}
	return connect.NewResponse(out), nil
}

// DeleteRoom implements WhiteboardRoomsService/DeleteRoom.
func (s *WhiteboardRoomsServer) DeleteRoom(
	ctx context.Context,
	req *connect.Request[pb.DeleteWhiteboardRoomRequest],
) (*connect.Response[pb.DeleteWhiteboardRoomResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	roomID, err := uuid.Parse(req.Msg.GetRoomId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid room_id: %w", err))
	}
	if err := s.H.DeleteRoom(ctx, roomID, uid); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.DeleteWhiteboardRoomResponse{Deleted: true}), nil
}

// toProto projects a domain.Room + participants into the wire type.
// Snapshot is NOT sent here (REST payload bloat) — the ws hydration frame
// delivers it on connect.
func (s *WhiteboardRoomsServer) toProto(r domain.Room, parts []domain.ParticipantWithUsername) *pb.WhiteboardRoom {
	out := &pb.WhiteboardRoom{
		Id:        r.ID.String(),
		OwnerId:   r.OwnerID.String(),
		Title:     r.Title,
		WsUrl:     s.WSURL(r.ID),
		ExpiresAt: timestamppb.New(r.ExpiresAt),
		CreatedAt: timestamppb.New(r.CreatedAt),
	}
	for _, p := range parts {
		out.Participants = append(out.Participants, &pb.WhiteboardParticipant{
			UserId:   p.UserID.String(),
			Username: p.Username,
			JoinedAt: timestamppb.New(p.JoinedAt),
		})
	}
	return out
}

func (s *WhiteboardRoomsServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrExpired):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		if s.Log != nil {
			s.Log.Error("whiteboard_rooms: internal", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, err)
	}
}
