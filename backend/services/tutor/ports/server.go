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

type TutorServer struct {
	CreateInviteUC    *app.CreateInvite
	RevokeInviteUC    *app.RevokeInvite
	AcceptInviteUC    *app.AcceptInvite
	ListInvitesUC     *app.ListInvites
	ListStudentsUC    *app.ListStudents
	PeekInviteUC      *app.PeekInvite
	EndRelationshipUC *app.EndRelationship
	GetSnapshotUC     *app.GetStudentSnapshot
	GenerateBriefUC   *app.GeneratePreSessionBrief

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

	TutorDisplay TutorDisplayLookup
	Log          *slog.Logger
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
	out := &pb.TutorListStudentsResponse{Items: make([]*pb.TutorRelationship, 0, len(items))}
	for _, rel := range items {
		out.Items = append(out.Items, toRelationshipProto(rel))
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

// ── error mapping ────────────────────────────────────────────────────

func (s *TutorServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInviteExpired),
		errors.Is(err, domain.ErrInviteRevoked),
		errors.Is(err, domain.ErrInviteAccepted),
		errors.Is(err, domain.ErrAlreadyEnrolled),
		errors.Is(err, domain.ErrAlreadyCompleted):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, domain.ErrSelfInvite),
		errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
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
		StudentId:             s.StudentID.String(),
		WindowDays:            int32(s.WindowDays),
		FocusMinutesWindow:    int32(s.FocusMinutesWindow),
		FocusSessionsCount:    int32(s.FocusSessionsCount),
		EnglishMocksCount:     int32(s.EnglishMocksCount),
		EnglishMocksAvgScore:  int32(s.EnglishMocksAvgScore),
		EnglishMocksLastScore: int32(s.EnglishMocksLastScore),
		NotesCount:            int32(s.NotesCount),
		WeakSpots:             make([]*pb.TutorWeakSpot, 0, len(s.WeakSpots)),
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
