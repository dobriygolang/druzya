// Shared reading library + invite-by-username + session notes RPCs.
// Split out of server.go to keep file size manageable.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/tutor/app"
	"druz9/tutor/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
	res, err := s.ListSharedReadingUC.Do(ctx, uid, int(req.Msg.GetLimit()), req.Msg.GetCursor())
	if err != nil {
		return nil, fmt.Errorf("tutor.ListSharedReading: %w", s.toConnectErr(err))
	}
	out := &pb.TutorListSharedReadingResponse{
		Items:      make([]*pb.TutorSharedMaterial, 0, len(res.Items)),
		NextCursor: res.NextCursor,
	}
	for _, m := range res.Items {
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

// ── Session-note visibility ──────────────────────────────────────────

// SetSessionNoteVisibility — tutor toggles share + optionally edits the
// student-facing curated copy. Tutor must own the event (else NotFound);
// event must be status='completed' (else FailedPrecondition).
//
// Best-effort audit log: emits a structured log line on visibility flips.
// Service-level audit pipeline can pick up the `audit=tutor.note_visibility`
// marker if needed downstream; this stays Go-stdlib slog only so it never
// blocks the save.
func (s *TutorServer) SetSessionNoteVisibility(
	ctx context.Context,
	req *connect.Request[pb.TutorSetSessionNoteVisibilityRequest],
) (*connect.Response[pb.TutorSetSessionNoteVisibilityResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.SetSessionNoteVisibilityUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("session-note visibility UC not wired"))
	}
	eventID, err := uuid.Parse(req.Msg.EventId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event_id: %w", err))
	}
	vis := eventVisibilityFromProto(req.Msg.Visibility)
	out, err := s.SetSessionNoteVisibilityUC.Do(ctx, app.SetSessionNoteVisibilityInput{
		TutorID:         uid,
		EventID:         eventID,
		Visibility:      vis,
		SharedContentMD: req.Msg.SharedContentMd,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.SetSessionNoteVisibility: %w", s.toConnectErr(err))
	}
	// Best-effort audit log — never blocks (see method comment).
	if s.Log != nil {
		s.Log.Info("tutor.note_visibility",
			slog.String("audit", "tutor.note_visibility"),
			slog.String("tutor_id", uid.String()),
			slog.String("event_id", eventID.String()),
			slog.String("visibility", string(vis)),
			slog.Bool("has_curated_copy", req.Msg.SharedContentMd != ""),
		)
	}
	return connect.NewResponse(&pb.TutorSetSessionNoteVisibilityResponse{
		Event: toEventProto(out),
	}), nil
}

// ListSharedSessionNotesForStudent — student-side feed.
func (s *TutorServer) ListSharedSessionNotesForStudent(
	ctx context.Context,
	req *connect.Request[pb.TutorListSharedSessionNotesForStudentRequest],
) (*connect.Response[pb.TutorListSharedSessionNotesForStudentResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.ListSharedSessionNotesForStudentUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("shared-notes feed UC not wired"))
	}
	out, err := s.ListSharedSessionNotesForStudentUC.Do(ctx, uid, int(req.Msg.Limit), req.Msg.Cursor)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListSharedSessionNotesForStudent: %w", s.toConnectErr(err))
	}
	items := make([]*pb.TutorSharedSessionNote, 0, len(out.Items))
	for _, n := range out.Items {
		items = append(items, toSharedSessionNoteProto(n))
	}
	return connect.NewResponse(&pb.TutorListSharedSessionNotesForStudentResponse{
		Items:      items,
		NextCursor: out.NextCursor,
	}), nil
}

func toSharedSessionNoteProto(n domain.SharedSessionNote) *pb.TutorSharedSessionNote {
	out := &pb.TutorSharedSessionNote{
		EventId:          n.EventID.String(),
		EventTitle:       n.EventTitle,
		TutorId:          n.TutorID.String(),
		TutorDisplayName: n.TutorDisplayName,
		TutorAvatarUrl:   n.TutorAvatarURL,
		SharedContentMd:  n.SharedContentMD,
	}
	if !n.ScheduledAt.IsZero() {
		out.ScheduledAt = timestamppb.New(n.ScheduledAt.UTC())
	}
	if !n.SharedAt.IsZero() {
		out.SharedAt = timestamppb.New(n.SharedAt.UTC())
	}
	return out
}
