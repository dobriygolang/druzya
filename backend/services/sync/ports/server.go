// Package ports — Connect-RPC adapter for the sync devices surface.
//
// /sync/pull and /sync/push stay chi-direct (binary blobs); only the
// device CRUD goes through proto+vanguard.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/sync/app"
	"druz9/sync/domain"
)

type Server struct {
	RegisterUC *app.RegisterDevice
	ListUC     *app.ListDevices
	RevokeUC   *app.RevokeDevice
	Log        *slog.Logger
}

var _ druz9v1connect.SyncServiceHandler = (*Server)(nil)

func (s *Server) RegisterDevice(
	ctx context.Context,
	req *connect.Request[pb.RegisterDeviceRequest],
) (*connect.Response[pb.SyncDevice], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if req.Msg.Name == "" || req.Msg.Platform == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("missing_fields"))
	}
	dev, err := s.RegisterUC.Run(ctx, app.RegisterInput{
		UserID:     uid,
		Name:       req.Msg.Name,
		Platform:   req.Msg.Platform,
		AppVersion: req.Msg.AppVersion,
	})
	if err != nil {
		if errors.Is(err, domain.ErrDeviceLimit) {
			// CodeAlreadyExists ≈ HTTP 409.
			return nil, connect.NewError(connect.CodeAlreadyExists,
				errors.New("device_limit_free: free tier supports 1 device"))
		}
		s.logErr(ctx, "RegisterDevice", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(deviceToProto(dev)), nil
}

func (s *Server) ListDevices(
	ctx context.Context,
	_ *connect.Request[pb.ListDevicesRequest],
) (*connect.Response[pb.SyncDeviceList], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	rows, err := s.ListUC.Run(ctx, uid)
	if err != nil {
		s.logErr(ctx, "ListDevices", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.SyncDeviceList{Items: make([]*pb.SyncDevice, 0, len(rows))}
	for _, d := range rows {
		out.Items = append(out.Items, deviceToProto(d))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) RevokeDevice(
	ctx context.Context,
	req *connect.Request[pb.RevokeDeviceRequest],
) (*connect.Response[pb.RevokeDeviceResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	if err := s.RevokeUC.Run(ctx, uid, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "RevokeDevice", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.RevokeDeviceResponse{Ok: true}), nil
}

func (s *Server) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "sync."+where, slog.Any("err", err))
}

func deviceToProto(d domain.Device) *pb.SyncDevice {
	return &pb.SyncDevice{
		Id:         d.ID.String(),
		Name:       d.Name,
		Platform:   d.Platform,
		AppVersion: d.AppVersion,
		LastSeenAt: timestamppb.New(d.LastSeenAt.UTC()),
		CreatedAt:  timestamppb.New(d.CreatedAt.UTC()),
	}
}
