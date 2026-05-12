// Package ports — Connect-RPC handlers for google_calendar.
package ports

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"druz9/google_calendar/app"
	"druz9/google_calendar/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var _ druz9v1connect.GoogleCalendarServiceHandler = (*Server)(nil)

type Server struct {
	H   *app.Handlers
	Log *slog.Logger
}

func New(h *app.Handlers, log *slog.Logger) *Server { return &Server{H: h, Log: log} }

func (s *Server) GetConnectionStatus(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[pb.ConnectionStatus], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	info, err := s.H.GetConnectionStatus(ctx, uid)
	if err != nil {
		return nil, s.toErr(err)
	}
	out := &pb.ConnectionStatus{
		Connected:  info.Connected,
		CalendarId: info.CalendarID,
	}
	if !info.LastSynced.IsZero() {
		out.LastSynced = timestamppb.New(info.LastSynced)
	}
	return connect.NewResponse(out), nil
}

func (s *Server) StartOAuth(
	ctx context.Context,
	req *connect.Request[pb.StartOAuthRequest],
) (*connect.Response[pb.StartOAuthResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	authURL, state, err := s.H.StartOAuth(ctx, uid, req.Msg.GetRedirectUri())
	if err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&pb.StartOAuthResponse{
		AuthUrl: authURL,
		State:   state,
	}), nil
}

func (s *Server) CompleteOAuth(
	ctx context.Context,
	req *connect.Request[pb.CompleteOAuthRequest],
) (*connect.Response[pb.ConnectionStatus], error) {
	// Auth-gate'нем в router'е через RequireConnectAuth=true. State проверка
	// инсайд use case-а: устаревший / уже consumed state → ErrInvalidState.
	_, info, err := s.H.CompleteOAuth(ctx, req.Msg.GetCode(), req.Msg.GetState(), req.Msg.GetRedirectUri())
	if err != nil {
		return nil, s.toErr(err)
	}
	out := &pb.ConnectionStatus{
		Connected:  info.Connected,
		CalendarId: info.CalendarID,
	}
	if !info.LastSynced.IsZero() {
		out.LastSynced = timestamppb.New(info.LastSynced)
	}
	return connect.NewResponse(out), nil
}

func (s *Server) Disconnect(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[emptypb.Empty], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if err := s.H.Disconnect(ctx, uid); err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (s *Server) SyncEvents(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[pb.SyncEventsResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	res, err := s.H.SyncEvents(ctx, uid)
	if err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&pb.SyncEventsResponse{
		Pulled: int32(res.Pulled),
		Pushed: int32(res.Pushed),
	}), nil
}

func (s *Server) ListEvents(
	ctx context.Context,
	req *connect.Request[pb.ListEventsRequest],
) (*connect.Response[pb.ListEventsResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	var from, to time.Time
	if t := req.Msg.GetFrom(); t != nil {
		from = t.AsTime()
	}
	if t := req.Msg.GetTo(); t != nil {
		to = t.AsTime()
	}
	list, err := s.H.ListEvents(ctx, uid, from, to)
	if err != nil {
		return nil, s.toErr(err)
	}
	out := &pb.ListEventsResponse{Items: make([]*pb.CalendarEvent, 0, len(list))}
	for _, e := range list {
		out.Items = append(out.Items, &pb.CalendarEvent{
			Id:            e.ID.String(),
			GoogleEventId: e.GoogleEventID,
			Title:         e.Title,
			Start:         timestamppb.New(e.Start),
			End:           timestamppb.New(e.End),
			Description:   e.Description,
		})
	}
	return connect.NewResponse(out), nil
}

func (s *Server) toErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrNotConnected):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, domain.ErrInvalidState):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrInvalidPayload):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrUpstream), errors.Is(err, domain.ErrTokenRefresh):
		return connect.NewError(connect.CodeUnavailable, err)
	default:
		if s.Log != nil {
			s.Log.Error("google_calendar: internal", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, err)
	}
}
