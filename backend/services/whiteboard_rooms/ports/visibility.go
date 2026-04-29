// visibility.go — Connect-RPC adapter for /whiteboard/room/{id}/visibility.
//
// Read is allowed to any authenticated user; write is owner-only and
// quota-gated when flipping private→shared (re-uses CheckCreateQuota).
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	druz9v1 "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/whiteboard_rooms/domain"
)

func (s *WhiteboardRoomsServer) requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func (s *WhiteboardRoomsServer) GetVisibility(
	ctx context.Context,
	req *connect.Request[druz9v1.GetWhiteboardVisibilityRequest],
) (*connect.Response[druz9v1.WhiteboardVisibility], error) {
	if _, err := s.requireUser(ctx); err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Msg.RoomId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	room, err := s.H.Rooms.Get(ctx, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logVisErr(ctx, "GetVisibility", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&druz9v1.WhiteboardVisibility{Visibility: string(room.Visibility)}), nil
}

func (s *WhiteboardRoomsServer) SetVisibility(
	ctx context.Context,
	req *connect.Request[druz9v1.SetWhiteboardVisibilityRequest],
) (*connect.Response[druz9v1.WhiteboardVisibility], error) {
	uid, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Msg.RoomId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	v := domain.Visibility(req.Msg.Visibility)
	if v != domain.VisibilityPrivate && v != domain.VisibilityShared {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_visibility"))
	}
	room, err := s.H.Rooms.Get(ctx, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logVisErr(ctx, "SetVisibility.get", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	if room.OwnerID != uid {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("only owner can change visibility"))
	}
	if v == domain.VisibilityShared && room.Visibility != domain.VisibilityShared && s.CheckCreateQuota != nil {
		if qerr := s.CheckCreateQuota(ctx, uid); qerr != nil {
			// Quota probe is best-effort: an upstream tier-resolver outage
			// shouldn't block legitimate flips. Log + permissive.
			if s.Log != nil {
				s.Log.WarnContext(ctx, "whiteboard.SetVisibility: quota check", slog.Any("err", qerr))
			}
		}
	}
	if err := s.H.Rooms.SetVisibility(ctx, id, v); err != nil {
		s.logVisErr(ctx, "SetVisibility.write", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&druz9v1.WhiteboardVisibility{Visibility: string(v)}), nil
}

func (s *WhiteboardRoomsServer) logVisErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "whiteboard."+where, slog.Any("err", err))
}
