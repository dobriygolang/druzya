// Package ports — Connect-RPC adapter for the calendar bounded context.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	calendarApp "druz9/calendar/app"
	calendarDomain "druz9/calendar/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
)

// Server wires use cases behind the generated CalendarServiceHandler.
//
// The use-case fields keep an UC suffix to avoid colliding with the
// generated method names (SetStatus, UpsertOutcome, ListEvents) — the
// connect-generated interface declares those as methods on Server.
type Server struct {
	druz9v1connect.UnimplementedCalendarServiceHandler // forward-compat for RPCs added later

	CreateUC        *calendarApp.CreateEvent
	UpdateUC        *calendarApp.UpdateEvent
	DeleteUC        *calendarApp.DeleteEvent
	ListUC          *calendarApp.ListEvents
	ListUpcomingUC  *calendarApp.ListUpcoming
	SetStatusUC     *calendarApp.SetEventStatus
	UpsertOutcomeUC *calendarApp.UpsertOutcome
	Log             *slog.Logger
}

// NewServer wires the adapter. log MUST be non-nil — server logs each
// internal failure before returning a CodeInternal error so operators
// can see why a row didn't persist.
func NewServer(
	create *calendarApp.CreateEvent,
	update *calendarApp.UpdateEvent,
	del *calendarApp.DeleteEvent,
	list *calendarApp.ListEvents,
	upcoming *calendarApp.ListUpcoming,
	status *calendarApp.SetEventStatus,
	outcome *calendarApp.UpsertOutcome,
	log *slog.Logger,
) *Server {
	if log == nil {
		panic("calendar/ports.NewServer: nil logger")
	}
	return &Server{
		CreateUC:        create,
		UpdateUC:        update,
		DeleteUC:        del,
		ListUC:          list,
		ListUpcomingUC:  upcoming,
		SetStatusUC:     status,
		UpsertOutcomeUC: outcome,
		Log:             log,
	}
}

// ListEvents — single endpoint serving the calendar grid AND the Hone
// upcoming chip AND the coach-side feed. Three caller shapes:
//   - (from, to)              → calendar grid month/week range.
//   - upcoming_within_days>0  → Hone Today + coach prompt (planned only).
//   - both                    → range wins; upcoming_within_days ignored.
func (s *Server) ListEvents(
	ctx context.Context,
	req *connect.Request[pb.ListPersonalEventsRequest],
) (*connect.Response[pb.ListPersonalEventsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	from, fromOk := timestampOK(req.Msg.GetFrom())
	to, toOk := timestampOK(req.Msg.GetTo())
	if fromOk && toOk {
		kinds := kindsFromProto(req.Msg.GetKinds())
		rows, listErr := s.ListUC.Do(ctx, calendarApp.ListEventsInput{
			UserID: uid, From: from, To: to, Kinds: kinds,
		})
		if listErr != nil {
			return nil, s.toConnectErr("ListEvents", listErr)
		}
		return connect.NewResponse(eventsResponseProto(rows)), nil
	}
	withinDays := int(req.Msg.GetUpcomingWithinDays())
	if withinDays <= 0 {
		withinDays = 30
	}
	rows, err := s.ListUpcomingUC.Do(ctx, uid, withinDays)
	if err != nil {
		return nil, s.toConnectErr("ListEvents.Upcoming", err)
	}
	return connect.NewResponse(eventsResponseProto(rows)), nil
}

// CreateEvent — POST /api/v1/calendar/events.
func (s *Server) CreateEvent(
	ctx context.Context,
	req *connect.Request[pb.CreatePersonalEventRequest],
) (*connect.Response[pb.PersonalEvent], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	in, err := inputFromProto(req.Msg.GetEvent())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	in.UserID = uid
	in.Source = sourceFromProto(req.Msg.GetSource())
	out, err := s.CreateUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr("CreateEvent", err)
	}
	return connect.NewResponse(eventToProto(eventWithEmptyCompany(out))), nil
}

// UpdateEvent — PUT /api/v1/calendar/events/{id}.
func (s *Server) UpdateEvent(
	ctx context.Context,
	req *connect.Request[pb.UpdatePersonalEventRequest],
) (*connect.Response[pb.PersonalEvent], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	createIn, err := inputFromProto(req.Msg.GetEvent())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	out, err := s.UpdateUC.Do(ctx, calendarApp.UpdateEventInput{
		UserID:           uid,
		EventID:          id,
		Kind:             createIn.Kind,
		Title:            createIn.Title,
		Description:      createIn.Description,
		StartsAt:         createIn.StartsAt,
		EndsAt:           createIn.EndsAt,
		AllDay:           createIn.AllDay,
		CompanyID:        createIn.CompanyID,
		Role:             createIn.Role,
		CurrentLevel:     createIn.CurrentLevel,
		ReadinessPct:     createIn.ReadinessPct,
		CodexArticleSlug: createIn.CodexArticleSlug,
		TrackID:          createIn.TrackID,
		ClubSessionID:    createIn.ClubSessionID,
	})
	if err != nil {
		return nil, s.toConnectErr("UpdateEvent", err)
	}
	return connect.NewResponse(eventToProto(eventWithEmptyCompany(out))), nil
}

// DeleteEvent — DELETE /api/v1/calendar/events/{id}.
func (s *Server) DeleteEvent(
	ctx context.Context,
	req *connect.Request[pb.DeletePersonalEventRequest],
) (*connect.Response[pb.DeletePersonalEventResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.DeleteUC.Do(ctx, uid, id); err != nil {
		return nil, s.toConnectErr("DeleteEvent", err)
	}
	return connect.NewResponse(&pb.DeletePersonalEventResponse{Ok: true}), nil
}

// SetStatus — POST /api/v1/calendar/events/{id}/status.
func (s *Server) SetStatus(
	ctx context.Context,
	req *connect.Request[pb.SetPersonalEventStatusRequest],
) (*connect.Response[pb.PersonalEvent], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	st := statusFromProto(req.Msg.GetStatus())
	if !st.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid status"))
	}
	out, err := s.SetStatusUC.Do(ctx, calendarApp.SetEventStatusInput{
		UserID: uid, EventID: id, Status: st,
	})
	if err != nil {
		return nil, s.toConnectErr("SetStatus", err)
	}
	return connect.NewResponse(eventToProto(eventWithEmptyCompany(out))), nil
}

// UpsertOutcome — POST /api/v1/calendar/events/{id}/outcome.
func (s *Server) UpsertOutcome(
	ctx context.Context,
	req *connect.Request[pb.UpsertPersonalEventOutcomeRequest],
) (*connect.Response[pb.PersonalEvent], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	var feltScorePtr *int
	if v := int(req.Msg.GetFeltScore()); v > 0 {
		feltScorePtr = &v
	}
	out, err := s.UpsertOutcomeUC.Do(ctx, calendarApp.UpsertOutcomeInput{
		UserID: uid, EventID: id,
		FeltScore: feltScorePtr,
		OutcomeMD: req.Msg.GetOutcomeMd(),
	})
	if err != nil {
		return nil, s.toConnectErr("UpsertOutcome", err)
	}
	return connect.NewResponse(eventToProto(eventWithEmptyCompany(out))), nil
}

// ── helpers ──────────────────────────────────────────────────────────────

func requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func (s *Server) toConnectErr(op string, err error) error {
	switch {
	case errors.Is(err, calendarDomain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, calendarDomain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, calendarDomain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	}
	if s.Log != nil {
		s.Log.ErrorContext(context.Background(), "calendar.ports."+op, slog.Any("err", err))
	}
	return connect.NewError(connect.CodeInternal, fmt.Errorf("internal"))
}

// inputFromProto packs the UI-side input into the use-case shape and
// validates the kind upfront so we surface a clean InvalidArgument.
func inputFromProto(p *pb.PersonalEventInput) (calendarApp.CreateEventInput, error) {
	if p == nil {
		return calendarApp.CreateEventInput{}, errors.New("event payload required")
	}
	starts, ok := timestampOK(p.GetStartsAt())
	if !ok {
		return calendarApp.CreateEventInput{}, errors.New("starts_at is required")
	}
	endsPtr, _ := timestampPtr(p.GetEndsAt())
	companyIDPtr, _ := optionalUUID(p.GetCompanyId())
	trackIDPtr, _ := optionalUUID(p.GetTrackId())
	clubIDPtr, _ := optionalUUID(p.GetClubSessionId())
	return calendarApp.CreateEventInput{
		Kind:             kindFromProto(p.GetKind()),
		Title:            p.GetTitle(),
		Description:      p.GetDescriptionMd(),
		StartsAt:         starts,
		EndsAt:           endsPtr,
		AllDay:           p.GetAllDay(),
		CompanyID:        companyIDPtr,
		Role:             p.GetRole(),
		CurrentLevel:     p.GetCurrentLevel(),
		ReadinessPct:     int(p.GetReadinessPct()),
		CodexArticleSlug: p.GetCodexArticleSlug(),
		TrackID:          trackIDPtr,
		ClubSessionID:    clubIDPtr,
	}, nil
}

func eventWithEmptyCompany(e calendarDomain.Event) calendarDomain.EventWithCompany {
	return calendarDomain.EventWithCompany{Event: e, CompanyName: ""}
}

func eventsResponseProto(rows []calendarDomain.EventWithCompany) *pb.ListPersonalEventsResponse {
	out := &pb.ListPersonalEventsResponse{Items: make([]*pb.PersonalEvent, 0, len(rows))}
	for _, e := range rows {
		out.Items = append(out.Items, eventToProto(e))
	}
	return out
}

func eventToProto(e calendarDomain.EventWithCompany) *pb.PersonalEvent {
	out := &pb.PersonalEvent{
		Id:               e.ID.String(),
		UserId:           e.UserID.String(),
		Kind:             kindToProto(e.Kind),
		Title:            e.Title,
		DescriptionMd:    e.Description,
		StartsAt:         timestamppb.New(e.StartsAt.UTC()),
		AllDay:           e.AllDay,
		CompanyName:      e.CompanyName,
		Role:             e.Role,
		CurrentLevel:     e.CurrentLevel,
		ReadinessPct:     int32(e.ReadinessPct),
		CodexArticleSlug: e.CodexArticleSlug,
		Status:           statusToProto(e.Status),
		OutcomeMd:        e.OutcomeMD,
		Source:           sourceToProto(e.Source),
		CreatedAt:        timestamppb.New(e.CreatedAt.UTC()),
		UpdatedAt:        timestamppb.New(e.UpdatedAt.UTC()),
	}
	if e.EndsAt != nil {
		out.EndsAt = timestamppb.New(e.EndsAt.UTC())
	}
	if e.CompanyID != nil {
		out.CompanyId = e.CompanyID.String()
	}
	if e.TrackID != nil {
		out.TrackId = e.TrackID.String()
	}
	if e.ClubSessionID != nil {
		out.ClubSessionId = e.ClubSessionID.String()
	}
	if e.FeltScore != nil {
		out.FeltScore = int32(*e.FeltScore)
	}
	if e.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(e.FinishedAt.UTC())
	}
	return out
}

// ── enum maps ────────────────────────────────────────────────────────────

func kindFromProto(k pb.PersonalEventKind) calendarDomain.Kind {
	switch k { //nolint:exhaustive // UNSPECIFIED falls through to "" (caller treats as no-filter / unknown)
	case pb.PersonalEventKind_PERSONAL_EVENT_KIND_INTERVIEW:
		return calendarDomain.KindInterview
	case pb.PersonalEventKind_PERSONAL_EVENT_KIND_DEADLINE:
		return calendarDomain.KindDeadline
	case pb.PersonalEventKind_PERSONAL_EVENT_KIND_EXAM:
		return calendarDomain.KindExam
	case pb.PersonalEventKind_PERSONAL_EVENT_KIND_CLUB_SESSION:
		return calendarDomain.KindClubSession
	case pb.PersonalEventKind_PERSONAL_EVENT_KIND_STUDY_BLOCK:
		return calendarDomain.KindStudyBlock
	case pb.PersonalEventKind_PERSONAL_EVENT_KIND_INTERVIEW_PREP_BLOCK:
		return calendarDomain.KindInterviewPrepBlock
	}
	return ""
}

func kindsFromProto(in []pb.PersonalEventKind) []calendarDomain.Kind {
	out := make([]calendarDomain.Kind, 0, len(in))
	for _, k := range in {
		if d := kindFromProto(k); d != "" {
			out = append(out, d)
		}
	}
	return out
}

func kindToProto(k calendarDomain.Kind) pb.PersonalEventKind {
	switch k {
	case calendarDomain.KindInterview:
		return pb.PersonalEventKind_PERSONAL_EVENT_KIND_INTERVIEW
	case calendarDomain.KindDeadline:
		return pb.PersonalEventKind_PERSONAL_EVENT_KIND_DEADLINE
	case calendarDomain.KindExam:
		return pb.PersonalEventKind_PERSONAL_EVENT_KIND_EXAM
	case calendarDomain.KindClubSession:
		return pb.PersonalEventKind_PERSONAL_EVENT_KIND_CLUB_SESSION
	case calendarDomain.KindStudyBlock:
		return pb.PersonalEventKind_PERSONAL_EVENT_KIND_STUDY_BLOCK
	case calendarDomain.KindInterviewPrepBlock:
		return pb.PersonalEventKind_PERSONAL_EVENT_KIND_INTERVIEW_PREP_BLOCK
	}
	return pb.PersonalEventKind_PERSONAL_EVENT_KIND_UNSPECIFIED
}

func statusFromProto(s pb.PersonalEventStatus) calendarDomain.Status {
	switch s { //nolint:exhaustive // UNSPECIFIED falls through to ""
	case pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_PLANNED:
		return calendarDomain.StatusPlanned
	case pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_LIVE:
		return calendarDomain.StatusLive
	case pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_DONE:
		return calendarDomain.StatusDone
	case pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_CANCELLED:
		return calendarDomain.StatusCancelled
	case pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_NO_SHOW:
		return calendarDomain.StatusNoShow
	}
	return ""
}

func statusToProto(s calendarDomain.Status) pb.PersonalEventStatus {
	switch s {
	case calendarDomain.StatusPlanned:
		return pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_PLANNED
	case calendarDomain.StatusLive:
		return pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_LIVE
	case calendarDomain.StatusDone:
		return pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_DONE
	case calendarDomain.StatusCancelled:
		return pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_CANCELLED
	case calendarDomain.StatusNoShow:
		return pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_NO_SHOW
	}
	return pb.PersonalEventStatus_PERSONAL_EVENT_STATUS_UNSPECIFIED
}

func sourceFromProto(s pb.PersonalEventSource) calendarDomain.Source {
	switch s { //nolint:exhaustive // UNSPECIFIED falls through to ""
	case pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_USER:
		return calendarDomain.SourceUser
	case pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_AI:
		return calendarDomain.SourceAI
	case pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_CLUB_CURATOR:
		return calendarDomain.SourceClubCurator
	case pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_INTEGRATION_TG:
		return calendarDomain.SourceIntegrationTG
	}
	return ""
}

func sourceToProto(s calendarDomain.Source) pb.PersonalEventSource {
	switch s {
	case calendarDomain.SourceUser:
		return pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_USER
	case calendarDomain.SourceAI:
		return pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_AI
	case calendarDomain.SourceClubCurator:
		return pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_CLUB_CURATOR
	case calendarDomain.SourceIntegrationTG:
		return pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_INTEGRATION_TG
	}
	return pb.PersonalEventSource_PERSONAL_EVENT_SOURCE_UNSPECIFIED
}

// ── small util ───────────────────────────────────────────────────────────

func timestampOK(t *timestamppb.Timestamp) (time.Time, bool) {
	if t == nil {
		return time.Time{}, false
	}
	return t.AsTime(), true
}

func timestampPtr(t *timestamppb.Timestamp) (*time.Time, bool) {
	if t == nil {
		return nil, false
	}
	v := t.AsTime()
	return &v, true
}

func optionalUUID(s string) (*uuid.UUID, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty string = "no UUID provided" — happy path, no value + no error.
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return nil, fmt.Errorf("optionalUUID: %w", err)
	}
	return &id, nil
}
