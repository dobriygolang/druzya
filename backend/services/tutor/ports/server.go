// Package ports exposes tutor use cases via Connect-RPC. Mirrors the
// pattern of profile/ports/server.go: a thin adapter struct, sentinel
// errors mapped to Connect codes, proto↔domain converters at the
// bottom of the file.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/tutor/app"
	"druz9/tutor/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion that TutorServer satisfies the generated handler.
var _ druz9v1connect.TutorServiceHandler = (*TutorServer)(nil)

// TutorDisplayLookup resolves a tutor's display name for the public
// PeekInvite landing. The handler doesn't import services/profile —
// instead it takes a function so wiring (cmd/monolith) can plug in
// whatever cache/repo it likes. Returning empty string is fine; the
// frontend falls back to «Тутор приглашает тебя» neutrally.
type TutorDisplayLookup func(ctx context.Context, tutorID uuid.UUID) string

// UserDisplayResolver — full user-display lookup for proto-time enrichment
// of TutorRelationship.display_* fields. ListMyTutors / ListStudents
// handlers вызывают для каждого rel'а; nil-safe (если nil — поля пустые).
// Single-user batched в map'у на handler-side чтобы не делать N+1 query.
type UserDisplayResolver interface {
	Resolve(ctx context.Context, userIDs []uuid.UUID) map[uuid.UUID]UserDisplay
}

// UserDisplay — wire-shape для proto.display_* полей.
type UserDisplay struct {
	Username    string
	DisplayName string
	AvatarURL   string
}

type TutorServer struct {
	CreateInviteUC *app.CreateInvite
	RevokeInviteUC *app.RevokeInvite
	AcceptInviteUC *app.AcceptInvite
	ListInvitesUC  *app.ListInvites
	ListStudentsUC *app.ListStudents
	// Wave 9.4 — student-side multi-tutor list.
	ListMyTutorsUC *app.ListMyTutors
	// Wave 9.5 — tutor analytics aggregate.
	GetTutorActivityUC *app.GetTutorActivity

	// Wave 5.2 — group events on circles.
	CreateGroupEventUC                  *app.CreateGroupEvent
	JoinEventUC                         *app.JoinEvent
	LeaveEventUC                        *app.LeaveEvent
	ListUpcomingGroupEventsForStudentUC *app.ListUpcomingGroupEventsForStudent
	GetEventRSVPCountUC                 *app.GetEventRSVPCount
	PeekInviteUC                        *app.PeekInvite
	EndRelationshipUC                   *app.EndRelationship
	GetSnapshotUC                       *app.GetStudentSnapshot
	GenerateBriefUC                     *app.GeneratePreSessionBrief

	// Wave 5.1 — assignments. Nil-safe per-handler (each method
	// rejects with Unimplemented when its UC isn't wired).
	PushAssignmentUC          *app.PushAssignment
	ListAssignmentsForTutorUC *app.ListAssignmentsForTutor
	ListPendingAssignmentsUC  *app.ListPendingForStudent
	CompleteAssignmentUC      *app.MarkAssignmentComplete
	ArchiveAssignmentUC       *app.ArchiveAssignment

	// Wave 5.2a — broadcast a single assignment to all of a tutor's
	// active students. Same nil-safe pattern.
	BroadcastAssignmentUC *app.BroadcastAssignment
	PushSharedReadingUC   *app.PushSharedReading
	ListSharedReadingUC   *app.ListSharedReading

	// Wave «Invite by @username» — pre-bound invite + student-side
	// pending list.
	InviteByUsernameUC        *app.InviteByUsername
	ListPendingInvitesForMeUC *app.ListPendingInvitesForMe

	// Phase 3.3 — tutor session notes-pad.
	GetSessionNotesUC  *app.GetSessionNotes
	SaveSessionNotesUC *app.SaveSessionNotes

	// Wave 5.2b — calendar events. Same nil-safe pattern.
	CreateEventUC                  *app.CreateEvent
	CancelEventUC                  *app.CancelEvent
	ListEventsForTutorUC           *app.ListEventsForTutor
	ListUpcomingEventsForStudentUC *app.ListUpcomingEventsForStudent
	// Wave 5.2d — event completion + session notes.
	CompleteEventUC *app.CompleteEvent

	TutorDisplay TutorDisplayLookup
	// Displays — bulk users lookup (username/display_name/avatar). Used for
	// ListMyTutors + ListStudents proto enrichment. nil-safe.
	Displays UserDisplayResolver
	Log      *slog.Logger
}

// ── RPCs ──────────────────────────────────────────────────────────────

func (s *TutorServer) CreateInvite(
	ctx context.Context,
	req *connect.Request[pb.TutorCreateInviteRequest],
) (*connect.Response[pb.TutorInvite], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	inv, err := s.CreateInviteUC.Do(ctx, app.CreateInviteInput{
		TutorID: uid,
		Note:    req.Msg.Note,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.CreateInvite: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toInviteProto(inv)), nil
}

func (s *TutorServer) RevokeInvite(
	ctx context.Context,
	req *connect.Request[pb.TutorRevokeInviteRequest],
) (*connect.Response[pb.TutorInvite], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	inviteID, err := uuid.Parse(req.Msg.InviteId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invite_id: %w", err))
	}
	if err := s.RevokeInviteUC.Do(ctx, app.RevokeInviteInput{TutorID: uid, InviteID: inviteID}); err != nil {
		return nil, fmt.Errorf("tutor.RevokeInvite: %w", s.toConnectErr(err))
	}
	// Re-fetch via list-then-find is overkill for one row; use peek by code.
	// But we don't have the code here — return a placeholder structure
	// with the id stamped revoked. The frontend can refresh ListInvites
	// after this call returns.
	return connect.NewResponse(&pb.TutorInvite{
		Id:     inviteID.String(),
		Status: pb.InviteStatus_INVITE_STATUS_REVOKED,
	}), nil
}

func (s *TutorServer) ListInvites(
	ctx context.Context,
	req *connect.Request[pb.TutorListInvitesRequest],
) (*connect.Response[pb.TutorListInvitesResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListInvitesUC.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListInvites: %w", s.toConnectErr(err))
	}
	out := &pb.TutorListInvitesResponse{Items: make([]*pb.TutorInvite, 0, len(items))}
	for _, inv := range items {
		out.Items = append(out.Items, toInviteProto(inv))
	}
	return connect.NewResponse(out), nil
}

// PeekInvite is public — no bearer requirement. Returning the invite
// info early helps the /invite/{code} landing page render before
// authentication.
func (s *TutorServer) PeekInvite(
	ctx context.Context,
	req *connect.Request[pb.TutorPeekInviteRequest],
) (*connect.Response[pb.TutorPeekInviteResponse], error) {
	res, err := s.PeekInviteUC.Do(ctx, req.Msg.Code)
	if err != nil {
		return nil, fmt.Errorf("tutor.PeekInvite: %w", s.toConnectErr(err))
	}
	display := ""
	if s.TutorDisplay != nil {
		display = s.TutorDisplay(ctx, res.Invite.TutorID)
	}
	return connect.NewResponse(&pb.TutorPeekInviteResponse{
		Invite:       toInviteProto(res.Invite),
		TutorDisplay: display,
	}), nil
}

func (s *TutorServer) AcceptInvite(
	ctx context.Context,
	req *connect.Request[pb.TutorAcceptInviteRequest],
) (*connect.Response[pb.TutorRelationship], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	rel, err := s.AcceptInviteUC.Do(ctx, app.AcceptInviteInput{StudentID: uid, Code: req.Msg.Code})
	if err != nil {
		return nil, fmt.Errorf("tutor.AcceptInvite: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toRelationshipProto(rel)), nil
}

func (s *TutorServer) ListStudents(
	ctx context.Context,
	_ *connect.Request[pb.TutorListStudentsRequest],
) (*connect.Response[pb.TutorListStudentsResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListStudentsUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListStudents: %w", s.toConnectErr(err))
	}
	// Display-enrichment: resolve student users.
	var displays map[uuid.UUID]UserDisplay
	if s.Displays != nil && len(items) > 0 {
		ids := make([]uuid.UUID, 0, len(items))
		for _, rel := range items {
			ids = append(ids, rel.StudentID)
		}
		displays = s.Displays.Resolve(ctx, ids)
	}
	out := &pb.TutorListStudentsResponse{Items: make([]*pb.TutorRelationship, 0, len(items))}
	for _, rel := range items {
		p := toRelationshipProto(rel)
		if d, ok := displays[rel.StudentID]; ok {
			p.DisplayUsername = d.Username
			p.DisplayName = d.DisplayName
			p.DisplayAvatarUrl = d.AvatarURL
		}
		out.Items = append(out.Items, p)
	}
	return connect.NewResponse(out), nil
}

// ListMyTutors — Wave 9.4 student-side endpoint.
func (s *TutorServer) ListMyTutors(
	ctx context.Context,
	_ *connect.Request[pb.TutorListMyTutorsRequest],
) (*connect.Response[pb.TutorListStudentsResponse], error) {
	if s.ListMyTutorsUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListMyTutors not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListMyTutorsUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListMyTutors: %w", s.toConnectErr(err))
	}
	// Display-enrichment: bulk-resolve tutor users → display fields. Без
	// resolver'а возвращаем opaque IDs (graceful).
	var displays map[uuid.UUID]UserDisplay
	if s.Displays != nil && len(items) > 0 {
		ids := make([]uuid.UUID, 0, len(items))
		for _, rel := range items {
			ids = append(ids, rel.TutorID)
		}
		displays = s.Displays.Resolve(ctx, ids)
	}
	out := &pb.TutorListStudentsResponse{Items: make([]*pb.TutorRelationship, 0, len(items))}
	for _, rel := range items {
		p := toRelationshipProto(rel)
		if d, ok := displays[rel.TutorID]; ok {
			p.DisplayUsername = d.Username
			p.DisplayName = d.DisplayName
			p.DisplayAvatarUrl = d.AvatarURL
		}
		out.Items = append(out.Items, p)
	}
	return connect.NewResponse(out), nil
}

func (s *TutorServer) GetStudentSnapshot(
	ctx context.Context,
	req *connect.Request[pb.TutorGetStudentSnapshotRequest],
) (*connect.Response[pb.TutorStudentSnapshot], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.GetSnapshotUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("snapshot UC not wired"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	snap, err := s.GetSnapshotUC.Do(ctx, app.GetStudentSnapshotInput{
		TutorID:    uid,
		StudentID:  studentID,
		WindowDays: int(req.Msg.WindowDays),
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.GetStudentSnapshot: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toSnapshotProto(snap)), nil
}

func (s *TutorServer) GeneratePreSessionBrief(
	ctx context.Context,
	req *connect.Request[pb.TutorGenerateBriefRequest],
) (*connect.Response[pb.TutorPreSessionBrief], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.GenerateBriefUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("brief UC not wired"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	out, err := s.GenerateBriefUC.Do(ctx, app.GetStudentSnapshotInput{
		TutorID:    uid,
		StudentID:  studentID,
		WindowDays: int(req.Msg.WindowDays),
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.GeneratePreSessionBrief: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorPreSessionBrief{
		Snapshot: toSnapshotProto(out.Snapshot),
		Brief:    out.Brief,
	}), nil
}

func (s *TutorServer) EndRelationship(
	ctx context.Context,
	req *connect.Request[pb.TutorEndRelationshipRequest],
) (*connect.Response[pb.TutorEndRelationshipResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	if err := s.EndRelationshipUC.Do(ctx, app.EndRelationshipInput{TutorID: uid, StudentID: studentID}); err != nil {
		return nil, fmt.Errorf("tutor.EndRelationship: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorEndRelationshipResponse{}), nil
}

// ── Assignments (Wave 5.1) ───────────────────────────────────────────

func (s *TutorServer) PushAssignment(
	ctx context.Context,
	req *connect.Request[pb.TutorPushAssignmentRequest],
) (*connect.Response[pb.TutorAssignment], error) {
	if s.PushAssignmentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("PushAssignment not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	in := app.PushAssignmentInput{
		TutorID:   uid,
		StudentID: studentID,
		Title:     req.Msg.Title,
		BodyMD:    req.Msg.BodyMd,
	}
	if req.Msg.DueAt != nil {
		t := req.Msg.DueAt.AsTime()
		in.DueAt = &t
	}
	out, err := s.PushAssignmentUC.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("tutor.PushAssignment: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toAssignmentProto(out)), nil
}

func (s *TutorServer) ListAssignmentsForTutor(
	ctx context.Context,
	req *connect.Request[pb.TutorListAssignmentsRequest],
) (*connect.Response[pb.TutorListAssignmentsResponse], error) {
	if s.ListAssignmentsForTutorUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListAssignmentsForTutor not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	items, err := s.ListAssignmentsForTutorUC.Do(ctx, app.ListAssignmentsForTutorInput{
		TutorID:   uid,
		StudentID: studentID,
		Limit:     int(req.Msg.Limit),
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.ListAssignmentsForTutor: %w", s.toConnectErr(err))
	}
	resp := &pb.TutorListAssignmentsResponse{Items: make([]*pb.TutorAssignment, 0, len(items))}
	for _, a := range items {
		resp.Items = append(resp.Items, toAssignmentProto(a))
	}
	return connect.NewResponse(resp), nil
}

func (s *TutorServer) ListPendingAssignments(
	ctx context.Context,
	req *connect.Request[pb.TutorListPendingAssignmentsRequest],
) (*connect.Response[pb.TutorListAssignmentsResponse], error) {
	if s.ListPendingAssignmentsUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListPendingAssignments not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListPendingAssignmentsUC.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListPendingAssignments: %w", s.toConnectErr(err))
	}
	resp := &pb.TutorListAssignmentsResponse{Items: make([]*pb.TutorAssignment, 0, len(items))}
	for _, a := range items {
		resp.Items = append(resp.Items, toAssignmentProto(a))
	}
	return connect.NewResponse(resp), nil
}

func (s *TutorServer) CompleteAssignment(
	ctx context.Context,
	req *connect.Request[pb.TutorCompleteAssignmentRequest],
) (*connect.Response[pb.TutorCompleteAssignmentResponse], error) {
	if s.CompleteAssignmentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("CompleteAssignment not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	aid, err := uuid.Parse(req.Msg.AssignmentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("assignment_id: %w", err))
	}
	if err := s.CompleteAssignmentUC.Do(ctx, uid, aid); err != nil {
		return nil, fmt.Errorf("tutor.CompleteAssignment: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorCompleteAssignmentResponse{}), nil
}

func (s *TutorServer) ArchiveAssignment(
	ctx context.Context,
	req *connect.Request[pb.TutorArchiveAssignmentRequest],
) (*connect.Response[pb.TutorArchiveAssignmentResponse], error) {
	if s.ArchiveAssignmentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ArchiveAssignment not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	aid, err := uuid.Parse(req.Msg.AssignmentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("assignment_id: %w", err))
	}
	if err := s.ArchiveAssignmentUC.Do(ctx, uid, aid); err != nil {
		return nil, fmt.Errorf("tutor.ArchiveAssignment: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorArchiveAssignmentResponse{}), nil
}

// BroadcastAssignment — Wave 5.2a. Per-student outcomes are surfaced
// in the response body; we DO NOT translate per-student errors into a
// Connect code because that would force callers to re-issue the whole
// batch. Top-level error is reserved for «could not start the batch
// at all» (auth, list-students RPC failure).
func (s *TutorServer) BroadcastAssignment(
	ctx context.Context,
	req *connect.Request[pb.TutorBroadcastAssignmentRequest],
) (*connect.Response[pb.TutorBroadcastAssignmentResponse], error) {
	if s.BroadcastAssignmentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("BroadcastAssignment not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	in := app.BroadcastAssignmentInput{
		TutorID: uid,
		Title:   req.Msg.Title,
		BodyMD:  req.Msg.BodyMd,
	}
	if req.Msg.DueAt != nil {
		t := req.Msg.DueAt.AsTime()
		in.DueAt = &t
	}
	out, err := s.BroadcastAssignmentUC.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("tutor.BroadcastAssignment: %w", s.toConnectErr(err))
	}
	resp := &pb.TutorBroadcastAssignmentResponse{
		Pushed: make([]*pb.TutorAssignment, 0, len(out.Pushed)),
		Failed: make([]*pb.TutorBroadcastFailure, 0, len(out.Failed)),
	}
	for _, a := range out.Pushed {
		resp.Pushed = append(resp.Pushed, toAssignmentProto(a))
	}
	for _, f := range out.Failed {
		resp.Failed = append(resp.Failed, &pb.TutorBroadcastFailure{
			StudentId: f.StudentID.String(),
			Error:     f.Err.Error(),
		})
	}
	return connect.NewResponse(resp), nil
}

// ── Events (Wave 5.2b) ──────────────────────────────────────────────

func (s *TutorServer) CreateEvent(
	ctx context.Context,
	req *connect.Request[pb.TutorCreateEventRequest],
) (*connect.Response[pb.TutorEvent], error) {
	if s.CreateEventUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("CreateEvent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	in := app.CreateEventInput{
		TutorID:     uid,
		StudentID:   studentID,
		Title:       req.Msg.Title,
		BodyMD:      req.Msg.BodyMd,
		DurationMin: int(req.Msg.DurationMin),
		MeetURL:     req.Msg.MeetUrl,
	}
	if req.Msg.ScheduledAt != nil {
		in.ScheduledAt = req.Msg.ScheduledAt.AsTime()
	}
	out, err := s.CreateEventUC.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("tutor.CreateEvent: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toEventProto(out)), nil
}

func (s *TutorServer) CancelEvent(
	ctx context.Context,
	req *connect.Request[pb.TutorCancelEventRequest],
) (*connect.Response[pb.TutorCancelEventResponse], error) {
	if s.CancelEventUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("CancelEvent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	eid, err := uuid.Parse(req.Msg.EventId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	if err := s.CancelEventUC.Do(ctx, app.CancelEventInput{
		TutorID: uid,
		EventID: eid,
		Reason:  req.Msg.Reason,
	}); err != nil {
		return nil, fmt.Errorf("tutor.CancelEvent: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorCancelEventResponse{}), nil
}

func (s *TutorServer) CompleteEvent(
	ctx context.Context,
	req *connect.Request[pb.TutorCompleteEventRequest],
) (*connect.Response[pb.TutorCompleteEventResponse], error) {
	if s.CompleteEventUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("CompleteEvent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	eid, err := uuid.Parse(req.Msg.EventId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	if err := s.CompleteEventUC.Do(ctx, app.CompleteEventInput{
		TutorID:     uid,
		EventID:     eid,
		SessionNote: req.Msg.SessionNote,
	}); err != nil {
		return nil, fmt.Errorf("tutor.CompleteEvent: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorCompleteEventResponse{}), nil
}

func (s *TutorServer) ListEventsForTutor(
	ctx context.Context,
	req *connect.Request[pb.TutorListEventsRequest],
) (*connect.Response[pb.TutorListEventsResponse], error) {
	if s.ListEventsForTutorUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListEventsForTutor not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListEventsForTutorUC.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListEventsForTutor: %w", s.toConnectErr(err))
	}
	resp := &pb.TutorListEventsResponse{Items: make([]*pb.TutorEvent, 0, len(items))}
	for _, ev := range items {
		resp.Items = append(resp.Items, toEventProto(ev))
	}
	return connect.NewResponse(resp), nil
}

func (s *TutorServer) ListUpcomingEventsForStudent(
	ctx context.Context,
	req *connect.Request[pb.TutorListUpcomingEventsRequest],
) (*connect.Response[pb.TutorListEventsResponse], error) {
	if s.ListUpcomingEventsForStudentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListUpcomingEventsForStudent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListUpcomingEventsForStudentUC.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListUpcomingEventsForStudent: %w", s.toConnectErr(err))
	}
	resp := &pb.TutorListEventsResponse{Items: make([]*pb.TutorEvent, 0, len(items))}
	for _, ev := range items {
		resp.Items = append(resp.Items, toEventProto(ev))
	}
	return connect.NewResponse(resp), nil
}

// GetTutorActivity — Wave 9.5 analytics aggregate.
func (s *TutorServer) GetTutorActivity(
	ctx context.Context,
	req *connect.Request[pb.TutorGetActivityRequest],
) (*connect.Response[pb.TutorActivityResponse], error) {
	if s.GetTutorActivityUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("GetTutorActivity not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.GetTutorActivityUC.Do(ctx, uid, int(req.Msg.WindowDays))
	if err != nil {
		return nil, fmt.Errorf("tutor.GetTutorActivity: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorActivityResponse{
		WindowDays:         int32(out.WindowDays),
		ActiveStudentCount: int32(out.ActiveStudentCount),
		EventsCompleted:    int32(out.EventsCompleted),
		EventsCancelled:    int32(out.EventsCancelled),
		EventsScheduled:    int32(out.EventsScheduled),
		MinutesTaught:      int32(out.MinutesTaught),
		CancellationRate:   out.CancellationRate,
	}), nil
}

// ── Group events (Wave 5.2) ────────────────────────────────────────

func (s *TutorServer) CreateGroupEvent(
	ctx context.Context,
	req *connect.Request[pb.TutorCreateGroupEventRequest],
) (*connect.Response[pb.TutorEvent], error) {
	if s.CreateGroupEventUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("CreateGroupEvent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	circleID, err := uuid.Parse(req.Msg.CircleId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("circle_id: %w", err))
	}
	in := app.CreateGroupEventInput{
		TutorID:     uid,
		CircleID:    circleID,
		Title:       req.Msg.Title,
		BodyMD:      req.Msg.BodyMd,
		DurationMin: int(req.Msg.DurationMin),
		MeetURL:     req.Msg.MeetUrl,
		Capacity:    int(req.Msg.Capacity),
	}
	if req.Msg.ScheduledAt != nil {
		in.ScheduledAt = req.Msg.ScheduledAt.AsTime()
	}
	out, err := s.CreateGroupEventUC.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("tutor.CreateGroupEvent: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toEventProto(out)), nil
}

func (s *TutorServer) JoinEvent(
	ctx context.Context,
	req *connect.Request[pb.TutorJoinEventRequest],
) (*connect.Response[pb.TutorJoinEventResponse], error) {
	if s.JoinEventUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("JoinEvent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	eid, err := uuid.Parse(req.Msg.EventId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	if err := s.JoinEventUC.Do(ctx, uid, eid); err != nil {
		return nil, fmt.Errorf("tutor.JoinEvent: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorJoinEventResponse{}), nil
}

func (s *TutorServer) LeaveEvent(
	ctx context.Context,
	req *connect.Request[pb.TutorLeaveEventRequest],
) (*connect.Response[pb.TutorLeaveEventResponse], error) {
	if s.LeaveEventUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("LeaveEvent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	eid, err := uuid.Parse(req.Msg.EventId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	if err := s.LeaveEventUC.Do(ctx, uid, eid); err != nil {
		return nil, fmt.Errorf("tutor.LeaveEvent: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorLeaveEventResponse{}), nil
}

func (s *TutorServer) ListUpcomingGroupEventsForStudent(
	ctx context.Context,
	req *connect.Request[pb.TutorListUpcomingGroupEventsRequest],
) (*connect.Response[pb.TutorListEventsResponse], error) {
	if s.ListUpcomingGroupEventsForStudentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListUpcomingGroupEventsForStudent not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListUpcomingGroupEventsForStudentUC.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListUpcomingGroupEventsForStudent: %w", s.toConnectErr(err))
	}
	resp := &pb.TutorListEventsResponse{Items: make([]*pb.TutorEvent, 0, len(items))}
	for _, ev := range items {
		resp.Items = append(resp.Items, toEventProto(ev))
	}
	return connect.NewResponse(resp), nil
}

func (s *TutorServer) GetEventRSVPCount(
	ctx context.Context,
	req *connect.Request[pb.TutorGetEventRSVPCountRequest],
) (*connect.Response[pb.TutorGetEventRSVPCountResponse], error) {
	if s.GetEventRSVPCountUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("GetEventRSVPCount not wired"))
	}
	if _, ok := sharedMw.UserIDFromContext(ctx); !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	eid, err := uuid.Parse(req.Msg.EventId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	count, err := s.GetEventRSVPCountUC.Do(ctx, eid)
	if err != nil {
		return nil, fmt.Errorf("tutor.GetEventRSVPCount: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorGetEventRSVPCountResponse{Count: int32(count)}), nil
}

// ── error mapping ────────────────────────────────────────────────────

func (s *TutorServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInviteExpired),
		errors.Is(err, domain.ErrInviteRevoked),
		errors.Is(err, domain.ErrInviteAccepted),
		errors.Is(err, domain.ErrAlreadyEnrolled),
		errors.Is(err, domain.ErrAlreadyCompleted),
		errors.Is(err, domain.ErrCapacityFull):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, domain.ErrSelfInvite),
		errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, app.ErrAccessDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		if s.Log != nil {
			s.Log.Error("tutor: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("tutor failure"))
	}
}

// ── converters ────────────────────────────────────────────────────────

func toInviteProto(inv domain.Invite) *pb.TutorInvite {
	out := &pb.TutorInvite{
		Id:        inv.ID.String(),
		TutorId:   inv.TutorID.String(),
		Code:      inv.Code,
		Note:      inv.Note,
		CreatedAt: timestamppb.New(inv.CreatedAt),
		ExpiresAt: timestamppb.New(inv.ExpiresAt),
		Status:    inviteStatusToProto(inv.Status(domainNow())),
	}
	if inv.AcceptedAt != nil {
		out.AcceptedAt = timestamppb.New(*inv.AcceptedAt)
	}
	if inv.AcceptedBy != nil {
		out.AcceptedBy = inv.AcceptedBy.String()
	}
	if inv.RevokedAt != nil {
		out.RevokedAt = timestamppb.New(*inv.RevokedAt)
	}
	return out
}

func toRelationshipProto(r domain.Relationship) *pb.TutorRelationship {
	out := &pb.TutorRelationship{
		Id:        r.ID.String(),
		TutorId:   r.TutorID.String(),
		StudentId: r.StudentID.String(),
		Note:      r.Note,
		StartedAt: timestamppb.New(r.StartedAt),
	}
	if r.InviteID != nil {
		out.InviteId = r.InviteID.String()
	}
	if r.EndedAt != nil {
		out.EndedAt = timestamppb.New(*r.EndedAt)
	}
	return out
}

func toEventProto(e domain.Event) *pb.TutorEvent {
	out := &pb.TutorEvent{
		Id:                 e.ID.String(),
		TutorId:            e.TutorID.String(),
		Title:              e.Title,
		BodyMd:             e.BodyMD,
		DurationMin:        int32(e.DurationMin),
		MeetUrl:            e.MeetURL,
		Status:             string(e.Status),
		CancellationReason: e.CancellationReason,
		SessionNote:        e.SessionNote,
	}
	if e.StudentID != nil {
		out.StudentId = e.StudentID.String()
	}
	if e.CircleID != nil {
		out.CircleId = e.CircleID.String()
	}
	if !e.ScheduledAt.IsZero() {
		out.ScheduledAt = timestamppb.New(e.ScheduledAt.UTC())
	}
	if e.Capacity != nil {
		out.Capacity = int32(*e.Capacity)
	}
	if !e.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(e.CreatedAt.UTC())
	}
	if !e.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(e.UpdatedAt.UTC())
	}
	return out
}

func toAssignmentProto(a domain.Assignment) *pb.TutorAssignment {
	out := &pb.TutorAssignment{
		Id:        a.ID.String(),
		TutorId:   a.TutorID.String(),
		StudentId: a.StudentID.String(),
		Title:     a.Title,
		BodyMd:    a.BodyMD,
		CreatedAt: timestamppb.New(a.CreatedAt),
	}
	if a.DueAt != nil {
		out.DueAt = timestamppb.New(*a.DueAt)
	}
	if a.CompletedAt != nil {
		out.CompletedAt = timestamppb.New(*a.CompletedAt)
	}
	if a.ArchivedAt != nil {
		out.ArchivedAt = timestamppb.New(*a.ArchivedAt)
	}
	return out
}

func inviteStatusToProto(s domain.InviteStatus) pb.InviteStatus {
	switch s {
	case domain.InviteStatusActive:
		return pb.InviteStatus_INVITE_STATUS_ACTIVE
	case domain.InviteStatusAccepted:
		return pb.InviteStatus_INVITE_STATUS_ACCEPTED
	case domain.InviteStatusRevoked:
		return pb.InviteStatus_INVITE_STATUS_REVOKED
	case domain.InviteStatusExpired:
		return pb.InviteStatus_INVITE_STATUS_EXPIRED
	default:
		return pb.InviteStatus_INVITE_STATUS_UNSPECIFIED
	}
}

// domainNow gives the converter a single «now» reference. Wrapped to
// keep the proto envelope consistent across two calls during the same
// rendering (status + accepted_at could otherwise straddle a second
// boundary). Tests can monkey-patch via the use-case Now() instead.
func domainNow() time.Time { return time.Now().UTC() }

func toSnapshotProto(s domain.StudentSnapshot) *pb.TutorStudentSnapshot {
	out := &pb.TutorStudentSnapshot{
		StudentId:               s.StudentID.String(),
		WindowDays:              int32(s.WindowDays),
		FocusMinutesWindow:      int32(s.FocusMinutesWindow),
		FocusSessionsCount:      int32(s.FocusSessionsCount),
		EnglishMocksCount:       int32(s.EnglishMocksCount),
		EnglishMocksAvgScore:    int32(s.EnglishMocksAvgScore),
		EnglishMocksLastScore:   int32(s.EnglishMocksLastScore),
		NotesCount:              int32(s.NotesCount),
		ReadingSessionsCount:    int32(s.ReadingSessionsCount),
		ReadingMinutesWindow:    int32(s.ReadingMinutesWindow),
		ReadingMaterialsTotal:   int32(s.ReadingMaterialsTotal),
		WritingGradesCount:      int32(s.WritingGradesCount),
		ListeningMaterialsTotal: int32(s.ListeningMaterialsTotal),
		VocabQueueTotal:         int32(s.VocabQueueTotal),
		VocabDueToday:           int32(s.VocabDueToday),
		WeakSpots:               make([]*pb.TutorWeakSpot, 0, len(s.WeakSpots)),
	}
	if !s.LastActiveAt.IsZero() {
		out.LastActiveAt = timestamppb.New(s.LastActiveAt)
	}
	for _, w := range s.WeakSpots {
		out.WeakSpots = append(out.WeakSpots, &pb.TutorWeakSpot{
			NodeKey:  w.NodeKey,
			Title:    w.Title,
			Progress: int32(w.Progress),
		})
	}
	return out
}

// ─── Shared reading library (Wave pivot 2026-05-02) ───────────────────────

func (s *TutorServer) PushSharedReading(
	ctx context.Context,
	req *connect.Request[pb.TutorPushSharedReadingRequest],
) (*connect.Response[pb.TutorPushSharedReadingResponse], error) {
	if s.PushSharedReadingUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("PushSharedReading not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	res, err := s.PushSharedReadingUC.Do(ctx, app.PushSharedReadingInput{
		TutorID:   uid,
		Title:     req.Msg.Title,
		SourceURL: req.Msg.SourceUrl,
		Note:      req.Msg.Note,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.PushSharedReading: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorPushSharedReadingResponse{
		Material:    toSharedMaterialProto(res.Material),
		PushedCount: int32(res.PushedCount),
		FailedCount: int32(res.FailedCount),
	}), nil
}

func (s *TutorServer) ListSharedReading(
	ctx context.Context,
	req *connect.Request[pb.TutorListSharedReadingRequest],
) (*connect.Response[pb.TutorListSharedReadingResponse], error) {
	if s.ListSharedReadingUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListSharedReading not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListSharedReadingUC.Do(ctx, uid, int(req.Msg.Limit))
	if err != nil {
		return nil, fmt.Errorf("tutor.ListSharedReading: %w", s.toConnectErr(err))
	}
	out := &pb.TutorListSharedReadingResponse{Items: make([]*pb.TutorSharedMaterial, 0, len(items))}
	for _, m := range items {
		out.Items = append(out.Items, toSharedMaterialProto(m))
	}
	return connect.NewResponse(out), nil
}

func toSharedMaterialProto(m domain.SharedMaterial) *pb.TutorSharedMaterial {
	out := &pb.TutorSharedMaterial{
		Id:           m.ID.String(),
		TutorId:      m.TutorID.String(),
		Title:        m.Title,
		SourceUrl:    m.SourceURL,
		BodyMd:       m.BodyMD,
		StudentCount: int32(m.StudentCount),
	}
	if !m.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(m.CreatedAt.UTC())
	}
	return out
}

// ── InviteByUsername / ListPendingInvitesForMe (Wave «invite by @user») ──

func (s *TutorServer) InviteByUsername(
	ctx context.Context,
	req *connect.Request[pb.TutorInviteByUsernameRequest],
) (*connect.Response[pb.TutorInvite], error) {
	if s.InviteByUsernameUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("InviteByUsername not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	inv, err := s.InviteByUsernameUC.Do(ctx, app.InviteByUsernameInput{
		TutorID:  uid,
		Username: req.Msg.Username,
		Note:     req.Msg.Note,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.InviteByUsername: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toInviteProto(inv)), nil
}

func (s *TutorServer) ListPendingInvitesForMe(
	ctx context.Context,
	_ *connect.Request[pb.TutorListPendingInvitesForMeRequest],
) (*connect.Response[pb.TutorListPendingInvitesForMeResponse], error) {
	if s.ListPendingInvitesForMeUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListPendingInvitesForMe not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	items, err := s.ListPendingInvitesForMeUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListPendingInvitesForMe: %w", s.toConnectErr(err))
	}
	// Bulk-resolve tutor displays.
	var displays map[uuid.UUID]UserDisplay
	if s.Displays != nil && len(items) > 0 {
		ids := make([]uuid.UUID, 0, len(items))
		for _, inv := range items {
			ids = append(ids, inv.TutorID)
		}
		displays = s.Displays.Resolve(ctx, ids)
	}
	out := &pb.TutorListPendingInvitesForMeResponse{Items: make([]*pb.TutorPendingInvite, 0, len(items))}
	for _, inv := range items {
		row := &pb.TutorPendingInvite{
			Id:      inv.ID.String(),
			Code:    inv.Code,
			Note:    inv.Note,
			TutorId: inv.TutorID.String(),
		}
		if !inv.CreatedAt.IsZero() {
			row.CreatedAt = timestamppb.New(inv.CreatedAt.UTC())
		}
		if !inv.ExpiresAt.IsZero() {
			row.ExpiresAt = timestamppb.New(inv.ExpiresAt.UTC())
		}
		if d, ok := displays[inv.TutorID]; ok {
			row.TutorUsername = d.Username
			row.TutorDisplayName = d.DisplayName
			row.TutorDisplayAvatar = d.AvatarURL
		}
		out.Items = append(out.Items, row)
	}
	return connect.NewResponse(out), nil
}

// ── Phase 3.3 — tutor session notes ──────────────────────────────────

func (s *TutorServer) GetSessionNotes(
	ctx context.Context,
	req *connect.Request[pb.TutorGetSessionNotesRequest],
) (*connect.Response[pb.TutorSessionNotes], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.GetSessionNotesUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("session notes UC not wired"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	n, err := s.GetSessionNotesUC.Do(ctx, uid, studentID)
	if err != nil {
		return nil, fmt.Errorf("tutor.GetSessionNotes: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toSessionNotesProto(n)), nil
}

func (s *TutorServer) SaveSessionNotes(
	ctx context.Context,
	req *connect.Request[pb.TutorSaveSessionNotesRequest],
) (*connect.Response[pb.TutorSessionNotes], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.SaveSessionNotesUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("session notes UC not wired"))
	}
	studentID, err := uuid.Parse(req.Msg.StudentId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("student_id: %w", err))
	}
	n, err := s.SaveSessionNotesUC.Do(ctx, uid, studentID, req.Msg.BodyMd)
	if err != nil {
		return nil, fmt.Errorf("tutor.SaveSessionNotes: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toSessionNotesProto(n)), nil
}

func toSessionNotesProto(n domain.SessionNotes) *pb.TutorSessionNotes {
	out := &pb.TutorSessionNotes{
		StudentId: n.StudentID.String(),
		BodyMd:    n.BodyMD,
	}
	if !n.UpdatedAt.IsZero() {
		out.UpdatedAt = n.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return out
}
