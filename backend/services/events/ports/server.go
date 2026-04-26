// Package ports — Connect-RPC handlers for events.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/events/app"
	"druz9/events/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var _ druz9v1connect.EventsServiceHandler = (*EventsServer)(nil)

type EventsServer struct {
	H   *app.Handlers
	Log *slog.Logger
}

func NewEventsServer(h *app.Handlers, log *slog.Logger) *EventsServer {
	return &EventsServer{H: h, Log: log}
}

func (s *EventsServer) CreateEvent(
	ctx context.Context,
	req *connect.Request[pb.CreateEventRequest],
) (*connect.Response[pb.Event], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	circleID, err := uuid.Parse(req.Msg.GetCircleId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("circle_id: %w", err))
	}
	in := domain.Event{
		CircleID:    circleID,
		Title:       req.Msg.GetTitle(),
		Description: req.Msg.GetDescription(),
		StartsAt:    req.Msg.GetStartsAt().AsTime(),
		DurationMin: int(req.Msg.GetDurationMin()),
		Recurrence:  fromRecurrenceProto(req.Msg.GetRecurrence()),
	}
	if raw := req.Msg.GetEditorRoomId(); raw != "" {
		id, perr := uuid.Parse(raw)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("editor_room_id: %w", perr))
		}
		in.EditorRoomID = &id
	}
	if raw := req.Msg.GetWhiteboardRoomId(); raw != "" {
		id, perr := uuid.Parse(raw)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("whiteboard_room_id: %w", perr))
		}
		in.WhiteboardRoomID = &id
	}
	full, err := s.H.CreateEvent(ctx, uid, in)
	if err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(toEventProto(full)), nil
}

func (s *EventsServer) GetEvent(
	ctx context.Context,
	req *connect.Request[pb.GetEventRequest],
) (*connect.Response[pb.Event], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	full, err := s.H.GetEvent(ctx, id, uid)
	if err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(toEventProto(full)), nil
}

func (s *EventsServer) ListMyEvents(
	ctx context.Context,
	req *connect.Request[pb.ListMyEventsRequest],
) (*connect.Response[pb.EventList], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	// proto3 timestamps: if the field is unset, GetFrom() returns nil and
	// AsTime() returns Unix epoch (1970-01-01) — not Go's zero time. We
	// must turn the nil case into time.Time{} so the handler can apply
	// its default window; otherwise the SQL filters on `[1970, 1970]`
	// and the response is always empty.
	var fromT, toT time.Time
	if ts := req.Msg.GetFrom(); ts != nil {
		fromT = ts.AsTime()
	}
	if ts := req.Msg.GetTo(); ts != nil {
		toT = ts.AsTime()
	}
	events, err := s.H.ListMyEvents(ctx, uid, fromT, toT)
	if err != nil {
		return nil, s.toErr(err)
	}
	out := &pb.EventList{Items: make([]*pb.Event, 0, len(events))}
	for _, e := range events {
		out.Items = append(out.Items, eventOnlyProto(e))
	}
	return connect.NewResponse(out), nil
}

func (s *EventsServer) JoinEvent(
	ctx context.Context,
	req *connect.Request[pb.JoinEventRequest],
) (*connect.Response[pb.Event], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	full, err := s.H.JoinEvent(ctx, id, uid)
	if err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(toEventProto(full)), nil
}

func (s *EventsServer) LeaveEvent(
	ctx context.Context,
	req *connect.Request[pb.LeaveEventRequest],
) (*connect.Response[pb.EventMutationResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	if err := s.H.LeaveEvent(ctx, id, uid); err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&pb.EventMutationResponse{Ok: true}), nil
}

func (s *EventsServer) DeleteEvent(
	ctx context.Context,
	req *connect.Request[pb.DeleteEventRequest],
) (*connect.Response[pb.EventMutationResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetEventId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	if err := s.H.DeleteEvent(ctx, id, uid); err != nil {
		return nil, s.toErr(err)
	}
	return connect.NewResponse(&pb.EventMutationResponse{Ok: true}), nil
}

func toEventProto(d app.EventDetails) *pb.Event {
	out := eventOnlyProto(d.Event)
	for _, p := range d.Participants {
		out.Participants = append(out.Participants, &pb.EventParticipant{
			UserId:   p.UserID.String(),
			Username: p.Username,
			JoinedAt: timestamppb.New(p.JoinedAt),
		})
	}
	return out
}

func eventOnlyProto(e domain.EventWithCircleName) *pb.Event {
	out := &pb.Event{
		Id:          e.ID.String(),
		CircleId:    e.CircleID.String(),
		CircleName:  e.CircleName,
		Title:       e.Title,
		Description: e.Description,
		StartsAt:    timestamppb.New(e.StartsAt),
		DurationMin: int32(e.DurationMin),
		Recurrence:  toRecurrenceProto(e.Recurrence),
		CreatedBy:   e.CreatedBy.String(),
		CreatedAt:   timestamppb.New(e.CreatedAt),
	}
	if e.EditorRoomID != nil {
		out.EditorRoomId = e.EditorRoomID.String()
	}
	if e.WhiteboardRoomID != nil {
		out.WhiteboardRoomId = e.WhiteboardRoomID.String()
	}
	return out
}

func toRecurrenceProto(r domain.Recurrence) pb.EventRecurrence {
	switch r {
	case domain.RecurrenceWeeklyFriday:
		return pb.EventRecurrence_EVENT_RECURRENCE_WEEKLY_FRIDAY
	case domain.RecurrenceNone:
		return pb.EventRecurrence_EVENT_RECURRENCE_NONE
	default:
		return pb.EventRecurrence_EVENT_RECURRENCE_UNSPECIFIED
	}
}

func fromRecurrenceProto(r pb.EventRecurrence) domain.Recurrence {
	switch r {
	case pb.EventRecurrence_EVENT_RECURRENCE_WEEKLY_FRIDAY:
		return domain.RecurrenceWeeklyFriday
	case pb.EventRecurrence_EVENT_RECURRENCE_NONE,
		pb.EventRecurrence_EVENT_RECURRENCE_UNSPECIFIED:
		return domain.RecurrenceNone
	default:
		return domain.RecurrenceNone
	}
}

func (s *EventsServer) toErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrConflict):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("events: internal", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, err)
	}
}
