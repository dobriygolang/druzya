// Package ports exposes the Hone domain via Connect-RPC. HoneServer
// implements druz9v1connect.HoneServiceHandler (generated from hone.proto).
//
// Wiring: cmd/monolith/services/hone.go constructs infra + app + NewHoneServer,
// then mounts via druz9v1connect.NewHoneServiceHandler + vanguard so the same
// handlers serve Connect-RPC and REST (/api/v1/hone/*) on the same paths.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/app"
	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — HoneServer satisfies the generated handler. This
// guard fires the first time `make gen-proto` generates the interface, which
// is also the first time this package can be compiled.
//
// STUB: uncomment once proto is generated (druz9v1connect.HoneServiceHandler
// doesn't exist yet). Kept commented so the package compiles in isolation.
//
// var _ druz9v1connect.HoneServiceHandler = (*HoneServer)(nil)

// Silence unused-import warning until the interface-guard above is enabled.
var _ = druz9v1connect.NewDailyServiceHandler

// HoneServer adapts hone use cases to Connect.
type HoneServer struct {
	H *app.Handler
}

// NewHoneServer wires a HoneServer around the Handler.
func NewHoneServer(h *app.Handler) *HoneServer { return &HoneServer{H: h} }

// ─── Plan ──────────────────────────────────────────────────────────────────

// GenerateDailyPlan implements druz9.v1.HoneService/GenerateDailyPlan.
func (s *HoneServer) GenerateDailyPlan(
	ctx context.Context,
	req *connect.Request[pb.GenerateDailyPlanRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.H.GeneratePlan.Do(ctx, app.GeneratePlanInput{
		UserID: uid,
		Force:  req.Msg.GetForce(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.GenerateDailyPlan: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// GetDailyPlan implements druz9.v1.HoneService/GetDailyPlan.
func (s *HoneServer) GetDailyPlan(
	ctx context.Context,
	_ *connect.Request[pb.GetDailyPlanRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.H.GetPlan.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.GetDailyPlan: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// DismissPlanItem implements druz9.v1.HoneService/DismissPlanItem.
func (s *HoneServer) DismissPlanItem(
	ctx context.Context,
	req *connect.Request[pb.DismissPlanItemRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id := req.Msg.GetItemId()
	if id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("item_id required"))
	}
	p, err := s.H.DismissPlanItem.Do(ctx, app.DismissPlanItemInput{UserID: uid, ItemID: id})
	if err != nil {
		return nil, fmt.Errorf("hone.DismissPlanItem: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// CompletePlanItem implements druz9.v1.HoneService/CompletePlanItem.
func (s *HoneServer) CompletePlanItem(
	ctx context.Context,
	req *connect.Request[pb.CompletePlanItemRequest],
) (*connect.Response[pb.Plan], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id := req.Msg.GetItemId()
	if id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("item_id required"))
	}
	p, err := s.H.CompletePlanItem.Do(ctx, app.CompletePlanItemInput{UserID: uid, ItemID: id})
	if err != nil {
		return nil, fmt.Errorf("hone.CompletePlanItem: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toPlanProto(p)), nil
}

// ─── Focus ─────────────────────────────────────────────────────────────────

// StartFocusSession implements druz9.v1.HoneService/StartFocusSession.
func (s *HoneServer) StartFocusSession(
	ctx context.Context,
	req *connect.Request[pb.StartFocusSessionRequest],
) (*connect.Response[pb.FocusSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	m := req.Msg
	sess, err := s.H.StartFocus.Do(ctx, app.StartFocusInput{
		UserID:      uid,
		PlanItemID:  m.GetPlanItemId(),
		PinnedTitle: m.GetPinnedTitle(),
		Mode:        domain.FocusMode(m.GetMode()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.StartFocusSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toFocusSessionProto(sess)), nil
}

// EndFocusSession implements druz9.v1.HoneService/EndFocusSession.
func (s *HoneServer) EndFocusSession(
	ctx context.Context,
	req *connect.Request[pb.EndFocusSessionRequest],
) (*connect.Response[pb.FocusSession], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	m := req.Msg
	sid, parseErr := uuid.Parse(m.GetSessionId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid session_id: %w", parseErr))
	}
	sess, err := s.H.EndFocus.Do(ctx, app.EndFocusInput{
		UserID:             uid,
		SessionID:          sid,
		PomodorosCompleted: int(m.GetPomodorosCompleted()),
		SecondsFocused:     int(m.GetSecondsFocused()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.EndFocusSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toFocusSessionProto(sess)), nil
}

// GetStats implements druz9.v1.HoneService/GetStats.
func (s *HoneServer) GetStats(
	ctx context.Context,
	req *connect.Request[pb.GetStatsRequest],
) (*connect.Response[pb.Stats], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	var upTo time.Time
	if raw := req.Msg.GetUpToDate(); raw != "" {
		t, parseErr := time.Parse("2006-01-02", raw)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid up_to_date: %w", parseErr))
		}
		upTo = t
	}
	st, err := s.H.GetStats.Do(ctx, app.GetStatsInput{UserID: uid, UpToDate: upTo})
	if err != nil {
		return nil, fmt.Errorf("hone.GetStats: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toStatsProto(st)), nil
}

// ─── Notes ─────────────────────────────────────────────────────────────────

// CreateNote implements druz9.v1.HoneService/CreateNote.
func (s *HoneServer) CreateNote(
	ctx context.Context,
	req *connect.Request[pb.CreateNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	n, err := s.H.CreateNote.Do(ctx, app.CreateNoteInput{
		UserID: uid,
		Title:  req.Msg.GetTitle(),
		BodyMD: req.Msg.GetBodyMd(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.CreateNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// UpdateNote implements druz9.v1.HoneService/UpdateNote.
func (s *HoneServer) UpdateNote(
	ctx context.Context,
	req *connect.Request[pb.UpdateNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	n, err := s.H.UpdateNote.Do(ctx, app.UpdateNoteInput{
		UserID: uid,
		NoteID: id,
		Title:  req.Msg.GetTitle(),
		BodyMD: req.Msg.GetBodyMd(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.UpdateNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// GetNote implements druz9.v1.HoneService/GetNote.
func (s *HoneServer) GetNote(
	ctx context.Context,
	req *connect.Request[pb.GetNoteRequest],
) (*connect.Response[pb.Note], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	n, err := s.H.GetNote.Do(ctx, uid, id)
	if err != nil {
		return nil, fmt.Errorf("hone.GetNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toNoteProto(n)), nil
}

// ListNotes implements druz9.v1.HoneService/ListNotes.
func (s *HoneServer) ListNotes(
	ctx context.Context,
	req *connect.Request[pb.ListNotesRequest],
) (*connect.Response[pb.ListNotesResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, cursor, err := s.H.ListNotes.Do(ctx, uid, int(req.Msg.GetLimit()), req.Msg.GetCursor())
	if err != nil {
		return nil, fmt.Errorf("hone.ListNotes: %w", s.toConnectErr(err))
	}
	resp := &pb.ListNotesResponse{NextCursor: cursor}
	for _, r := range rows {
		resp.Notes = append(resp.Notes, toNoteSummaryProto(r))
	}
	return connect.NewResponse(resp), nil
}

// DeleteNote implements druz9.v1.HoneService/DeleteNote.
func (s *HoneServer) DeleteNote(
	ctx context.Context,
	req *connect.Request[pb.DeleteNoteRequest],
) (*connect.Response[pb.DeleteNoteResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	if err := s.H.DeleteNote.Do(ctx, uid, id); err != nil {
		return nil, fmt.Errorf("hone.DeleteNote: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteNoteResponse{}), nil
}

// GetNoteConnections implements druz9.v1.HoneService/GetNoteConnections (server-streaming).
func (s *HoneServer) GetNoteConnections(
	ctx context.Context,
	req *connect.Request[pb.GetNoteConnectionsRequest],
	stream *connect.ServerStream[pb.Connection],
) error {
	uid, err := requireUser(ctx)
	if err != nil {
		return err
	}
	id, parseErr := uuid.Parse(req.Msg.GetNoteId())
	if parseErr != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid note_id: %w", parseErr))
	}
	err = s.H.GetNoteConnections.Do(ctx, app.GetNoteConnectionsInput{UserID: uid, NoteID: id}, func(c domain.Connection) error {
		return stream.Send(toConnectionProto(c))
	})
	if err != nil {
		return fmt.Errorf("hone.GetNoteConnections: %w", s.toConnectErr(err))
	}
	return nil
}

// ─── Whiteboards ───────────────────────────────────────────────────────────

// CreateWhiteboard implements druz9.v1.HoneService/CreateWhiteboard.
func (s *HoneServer) CreateWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.CreateWhiteboardRequest],
) (*connect.Response[pb.Whiteboard], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	wb, err := s.H.CreateWhiteboard.Do(ctx, app.CreateWhiteboardInput{
		UserID:    uid,
		Title:     req.Msg.GetTitle(),
		StateJSON: []byte(req.Msg.GetStateJson()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.CreateWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWhiteboardProto(wb)), nil
}

// UpdateWhiteboard implements druz9.v1.HoneService/UpdateWhiteboard.
func (s *HoneServer) UpdateWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.UpdateWhiteboardRequest],
) (*connect.Response[pb.Whiteboard], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	wb, err := s.H.UpdateWhiteboard.Do(ctx, app.UpdateWhiteboardInput{
		UserID:          uid,
		WhiteboardID:    id,
		Title:           req.Msg.GetTitle(),
		StateJSON:       []byte(req.Msg.GetStateJson()),
		ExpectedVersion: int(req.Msg.GetExpectedVersion()),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.UpdateWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWhiteboardProto(wb)), nil
}

// GetWhiteboard implements druz9.v1.HoneService/GetWhiteboard.
func (s *HoneServer) GetWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.GetWhiteboardRequest],
) (*connect.Response[pb.Whiteboard], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	wb, err := s.H.GetWhiteboard.Do(ctx, uid, id)
	if err != nil {
		return nil, fmt.Errorf("hone.GetWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWhiteboardProto(wb)), nil
}

// ListWhiteboards implements druz9.v1.HoneService/ListWhiteboards.
func (s *HoneServer) ListWhiteboards(
	ctx context.Context,
	_ *connect.Request[pb.ListWhiteboardsRequest],
) (*connect.Response[pb.ListWhiteboardsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.H.ListWhiteboards.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.ListWhiteboards: %w", s.toConnectErr(err))
	}
	resp := &pb.ListWhiteboardsResponse{}
	for _, r := range rows {
		resp.Whiteboards = append(resp.Whiteboards, &pb.WhiteboardSummary{
			Id:        r.ID.String(),
			Title:     r.Title,
			UpdatedAt: timestamppb.New(r.UpdatedAt.UTC()),
		})
	}
	return connect.NewResponse(resp), nil
}

// DeleteWhiteboard implements druz9.v1.HoneService/DeleteWhiteboard.
func (s *HoneServer) DeleteWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.DeleteWhiteboardRequest],
) (*connect.Response[pb.DeleteWhiteboardResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	if err := s.H.DeleteWhiteboard.Do(ctx, uid, id); err != nil {
		return nil, fmt.Errorf("hone.DeleteWhiteboard: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteWhiteboardResponse{}), nil
}

// CritiqueWhiteboard implements druz9.v1.HoneService/CritiqueWhiteboard (server-streaming).
func (s *HoneServer) CritiqueWhiteboard(
	ctx context.Context,
	req *connect.Request[pb.CritiqueWhiteboardRequest],
	stream *connect.ServerStream[pb.CritiquePacket],
) error {
	uid, err := requireUser(ctx)
	if err != nil {
		return err
	}
	id, parseErr := uuid.Parse(req.Msg.GetId())
	if parseErr != nil {
		return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", parseErr))
	}
	err = s.H.CritiqueWhiteboard.Do(ctx, app.CritiqueWhiteboardInput{UserID: uid, WhiteboardID: id}, func(p domain.CritiquePacket) error {
		return stream.Send(&pb.CritiquePacket{
			Section: string(p.Section),
			Delta:   p.Delta,
			Done:    p.Done,
		})
	})
	if err != nil {
		return fmt.Errorf("hone.CritiqueWhiteboard: %w", s.toConnectErr(err))
	}
	return nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func (s *HoneServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrNotOwner):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrStaleVersion):
		return connect.NewError(connect.CodeAborted, err)
	case errors.Is(err, domain.ErrLLMUnavailable), errors.Is(err, domain.ErrEmbeddingUnavailable):
		s.H.Log.Warn("hone: AI subsystem unavailable", slog.Any("err", err))
		return connect.NewError(connect.CodeUnavailable, err)
	default:
		s.H.Log.Error("hone: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("hone failure"))
	}
}

// ── converters (domain → proto) ────────────────────────────────────────────

func toPlanProto(p domain.Plan) *pb.Plan {
	out := &pb.Plan{
		Id:            p.ID.String(),
		Date:          p.Date.Format("2006-01-02"),
		RegeneratedAt: timestamppb.New(p.RegeneratedAt.UTC()),
	}
	for _, it := range p.Items {
		out.Items = append(out.Items, &pb.PlanItem{
			Id:           it.ID,
			Kind:         string(it.Kind),
			Title:        it.Title,
			Subtitle:     it.Subtitle,
			TargetRef:    it.TargetRef,
			DeepLink:     it.DeepLink,
			EstimatedMin: int32(it.EstimatedMin),
			Dismissed:    it.Dismissed,
			Completed:    it.Completed,
		})
	}
	return out
}

func toFocusSessionProto(s domain.FocusSession) *pb.FocusSession {
	out := &pb.FocusSession{
		Id:                 s.ID.String(),
		PlanItemId:         s.PlanItemID,
		PinnedTitle:        s.PinnedTitle,
		StartedAt:          timestamppb.New(s.StartedAt.UTC()),
		PomodorosCompleted: int32(s.PomodorosCompleted),
		SecondsFocused:     int32(s.SecondsFocused),
		Mode:               string(s.Mode),
	}
	if s.EndedAt != nil {
		out.EndedAt = timestamppb.New(s.EndedAt.UTC())
	}
	return out
}

func toStatsProto(s domain.Stats) *pb.Stats {
	out := &pb.Stats{
		CurrentStreakDays:   int32(s.CurrentStreakDays),
		LongestStreakDays:   int32(s.LongestStreakDays),
		TotalFocusedSeconds: int32(s.TotalFocusedSecs),
	}
	for _, d := range s.Heatmap {
		out.Heatmap = append(out.Heatmap, &pb.FocusHeatmapDay{
			Date:     d.Day.Format("2006-01-02"),
			Seconds:  int32(d.FocusedSeconds),
			Sessions: int32(d.SessionsCount),
		})
	}
	for _, d := range s.LastSevenDays {
		out.LastSevenDays = append(out.LastSevenDays, &pb.FocusHeatmapDay{
			Date:     d.Day.Format("2006-01-02"),
			Seconds:  int32(d.FocusedSeconds),
			Sessions: int32(d.SessionsCount),
		})
	}
	return out
}

func toNoteProto(n domain.Note) *pb.Note {
	return &pb.Note{
		Id:        n.ID.String(),
		Title:     n.Title,
		BodyMd:    n.BodyMD,
		CreatedAt: timestamppb.New(n.CreatedAt.UTC()),
		UpdatedAt: timestamppb.New(n.UpdatedAt.UTC()),
		SizeBytes: int32(n.SizeBytes),
	}
}

func toNoteSummaryProto(n domain.NoteSummary) *pb.NoteSummary {
	return &pb.NoteSummary{
		Id:        n.ID.String(),
		Title:     n.Title,
		UpdatedAt: timestamppb.New(n.UpdatedAt.UTC()),
		SizeBytes: int32(n.SizeBytes),
	}
}

func toConnectionProto(c domain.Connection) *pb.Connection {
	return &pb.Connection{
		Kind:         string(c.Kind),
		TargetId:     c.TargetID,
		DisplayTitle: c.DisplayTitle,
		Snippet:      c.Snippet,
		Similarity:   c.Similarity,
	}
}

func toWhiteboardProto(wb domain.Whiteboard) *pb.Whiteboard {
	return &pb.Whiteboard{
		Id:        wb.ID.String(),
		Title:     wb.Title,
		StateJson: string(wb.StateJSON),
		CreatedAt: timestamppb.New(wb.CreatedAt.UTC()),
		UpdatedAt: timestamppb.New(wb.UpdatedAt.UTC()),
		Version:   int32(wb.Version),
	}
}
