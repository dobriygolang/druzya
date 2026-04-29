// visibility.go — Connect-RPC adapter for /editor/room/{id}/visibility.
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

	"druz9/editor/domain"
	druz9v1 "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

func (s *EditorServer) GetVisibility(
	ctx context.Context,
	req *connect.Request[druz9v1.GetEditorVisibilityRequest],
) (*connect.Response[druz9v1.EditorVisibility], error) {
	if s.Rooms == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	if _, err := s.requireUser(ctx); err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Msg.RoomId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	room, err := s.Rooms.Get(ctx, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logVisErr(ctx, "GetVisibility", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&druz9v1.EditorVisibility{Visibility: string(room.Visibility)}), nil
}

func (s *EditorServer) SetVisibility(
	ctx context.Context,
	req *connect.Request[druz9v1.SetEditorVisibilityRequest],
) (*connect.Response[druz9v1.EditorVisibility], error) {
	if s.Rooms == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
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
	room, err := s.Rooms.Get(ctx, id)
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
			if s.Log != nil {
				s.Log.WarnContext(ctx, "editor.SetVisibility: quota check", slog.Any("err", qerr))
			}
		}
	}
	if err := s.Rooms.SetVisibility(ctx, id, v); err != nil {
		s.logVisErr(ctx, "SetVisibility.write", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&druz9v1.EditorVisibility{Visibility: string(v)}), nil
}

func (s *EditorServer) requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func (s *EditorServer) logVisErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "editor."+where, slog.Any("err", err))
}
