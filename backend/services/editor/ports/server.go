// Package ports wires the editor domain to HTTP via Connect-RPC and a
// raw WebSocket.
//
// HTTP: EditorServer implements druz9v1connect.EditorServiceHandler
// (generated from proto/druz9/v1/editor.proto). The five REST endpoints at
// /api/v1/editor/room/* are served via vanguard transcoding; the native
// Connect path is /druz9.v1.EditorService/*.
//
// WebSocket: /ws/editor/{roomId} is NOT part of the proto — Connect cannot
// transcode WebSockets. The raw chi handler in ports/ws.go + ports/ws_handler.go
// stays intact and continues to handle YJS op fanout.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/editor/app"
	"druz9/editor/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — EditorServer satisfies the generated handler.
var _ druz9v1connect.EditorServiceHandler = (*EditorServer)(nil)

// EditorServer adapts editor use cases to Connect.
//
// Field names use the UC suffix to avoid collision with the generated method
// names (CreateRoom / GetRoom / CreateInvite / FreezeRoom / GetReplay).
type EditorServer struct {
	CreateUC *app.CreateRoom
	GetUC    *app.GetRoom
	InviteUC *app.CreateInvite
	FreezeUC *app.Freeze
	ReplayUC *app.Replay
	RunUC    *app.RunCode
	WSBase   string // used to synthesise ws_url on the EditorRoom DTO
	Log      *slog.Logger
}

// NewEditorServer wires the Connect adapter.
func NewEditorServer(
	create *app.CreateRoom,
	get *app.GetRoom,
	invite *app.CreateInvite,
	freeze *app.Freeze,
	replay *app.Replay,
	run *app.RunCode,
	wsBase string,
	log *slog.Logger,
) *EditorServer {
	return &EditorServer{
		CreateUC: create, GetUC: get, InviteUC: invite,
		FreezeUC: freeze, ReplayUC: replay, RunUC: run,
		WSBase: wsBase, Log: log,
	}
}

// CreateRoom implements druz9.v1.EditorService/CreateRoom.
func (s *EditorServer) CreateRoom(
	ctx context.Context,
	req *connect.Request[pb.CreateRoomRequest],
) (*connect.Response[pb.EditorRoom], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	in := app.CreateRoomInput{
		OwnerID:  uid,
		Language: languageFromProtoEditor(m.GetLanguage()),
	}
	if t := m.GetType(); t != "" {
		in.Type = domain.RoomType(t)
	}
	if raw := m.GetTaskId(); raw != "" {
		tid, err := uuid.Parse(raw)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid task_id: %w", err))
		}
		in.TaskID = &tid
	}
	out, err := s.CreateUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(s.toEditorRoomProto(out.Room, out.Participants, nil)), nil
}

// GetRoom implements druz9.v1.EditorService/GetRoom.
func (s *EditorServer) GetRoom(
	ctx context.Context,
	req *connect.Request[pb.GetRoomRequest],
) (*connect.Response[pb.EditorRoom], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	roomID, err := uuid.Parse(req.Msg.GetRoomId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid room_id: %w", err))
	}
	res, err := s.GetUC.Do(ctx, roomID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if !isParticipant(uid, res.Room.OwnerID, res.Participants) {
		return nil, connect.NewError(connect.CodePermissionDenied, domain.ErrForbidden)
	}
	return connect.NewResponse(s.toEditorRoomProto(res.Room, res.Participants, res.Task)), nil
}

// CreateInvite implements druz9.v1.EditorService/CreateInvite.
func (s *EditorServer) CreateInvite(
	ctx context.Context,
	req *connect.Request[pb.CreateInviteRequest],
) (*connect.Response[pb.InviteLink], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	roomID, err := uuid.Parse(req.Msg.GetRoomId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid room_id: %w", err))
	}
	link, err := s.InviteUC.Do(ctx, app.CreateInviteInput{RoomID: roomID, CallerID: uid})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.InviteLink{Url: link.URL}
	if !link.ExpiresAt.IsZero() {
		out.ExpiresAt = timestamppb.New(link.ExpiresAt.UTC())
	}
	return connect.NewResponse(out), nil
}

// FreezeRoom implements druz9.v1.EditorService/FreezeRoom.
func (s *EditorServer) FreezeRoom(
	ctx context.Context,
	req *connect.Request[pb.FreezeRoomRequest],
) (*connect.Response[pb.EditorRoom], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	roomID, err := uuid.Parse(req.Msg.GetRoomId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid room_id: %w", err))
	}
	room, err := s.FreezeUC.Do(ctx, app.FreezeInput{
		RoomID: roomID, CallerID: uid, Frozen: req.Msg.GetFrozen(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	// Hydrate participants for the response — same behaviour as the apigen
	// version.
	res, _ := s.GetUC.Do(ctx, roomID)
	return connect.NewResponse(s.toEditorRoomProto(room, res.Participants, res.Task)), nil
}

// GetReplay implements druz9.v1.EditorService/GetReplay.
func (s *EditorServer) GetReplay(
	ctx context.Context,
	req *connect.Request[pb.GetReplayRequest],
) (*connect.Response[pb.ReplayUrl], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	roomID, err := uuid.Parse(req.Msg.GetRoomId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid room_id: %w", err))
	}
	res, err := s.ReplayUC.Do(ctx, roomID, uid)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.ReplayUrl{Url: res.URL}
	if !res.ExpiresAt.IsZero() {
		out.ExpiresAt = timestamppb.New(res.ExpiresAt.UTC())
	}
	return connect.NewResponse(out), nil
}

// RunCode implements druz9.v1.EditorService/RunCode.
func (s *EditorServer) RunCode(
	ctx context.Context,
	req *connect.Request[pb.RunCodeRequest],
) (*connect.Response[pb.RunCodeResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.RunUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			errors.New("sandbox is not configured — set JUDGE0_URL"))
	}
	roomID, err := uuid.Parse(req.Msg.GetRoomId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid room_id: %w", err))
	}
	res, err := s.RunUC.Do(ctx, app.RunCodeInput{
		RoomID:   roomID,
		CallerID: uid,
		Code:     req.Msg.GetCode(),
		Language: languageFromProtoEditor(req.Msg.GetLanguage()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.RunCodeResponse{
		Stdout:   res.Stdout,
		Stderr:   res.Stderr,
		ExitCode: res.ExitCode,
		TimeMs:   res.TimeMs,
		Status:   res.Status,
	}), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *EditorServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrInvalidInvite),
		errors.Is(err, domain.ErrInvalidState):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrSandboxUnavailable):
		return connect.NewError(connect.CodeUnavailable, err)
	case errors.Is(err, domain.ErrRateLimited):
		return connect.NewError(connect.CodeResourceExhausted, err)
	default:
		if s.Log != nil {
			s.Log.Error("editor: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("editor failure"))
	}
}

// ── converters (domain → proto) ───────────────────────────────────────────

func (s *EditorServer) toEditorRoomProto(r domain.Room, ps []domain.Participant, task *domain.TaskPublic) *pb.EditorRoom {
	out := &pb.EditorRoom{
		Id:       r.ID.String(),
		OwnerId:  r.OwnerID.String(),
		Type:     string(r.Type),
		Language: languageToProtoEditor(r.Language),
		IsFrozen: r.IsFrozen,
	}
	if !r.ExpiresAt.IsZero() {
		out.ExpiresAt = timestamppb.New(r.ExpiresAt.UTC())
	}
	wsURL := s.WSBase
	if wsURL == "" {
		wsURL = "/ws/editor"
	}
	out.WsUrl = wsURL + "/" + r.ID.String()

	if task != nil {
		out.Task = &pb.EditorTaskPublic{
			Id:          task.ID.String(),
			Slug:        task.Slug,
			Title:       task.Title,
			Description: task.Description,
			Difficulty:  difficultyToProtoEditor(task.Difficulty),
			Section:     sectionToProtoEditor(task.Section),
		}
	}
	if len(ps) > 0 {
		for _, p := range ps {
			out.Participants = append(out.Participants, &pb.EditorParticipant{
				UserId:   p.UserID.String(),
				Username: "", // STUB — profile lookup is wired in a later PR.
				Role:     editorRoleToProto(p.Role),
			})
		}
	}
	return out
}

func isParticipant(uid, owner uuid.UUID, ps []domain.Participant) bool {
	if uid == owner {
		return true
	}
	for _, p := range ps {
		if p.UserID == uid {
			return true
		}
	}
	return false
}

// ── enum adapters ─────────────────────────────────────────────────────────

func languageFromProtoEditor(l pb.Language) enums.Language {
	switch l {
	case pb.Language_LANGUAGE_UNSPECIFIED:
		return ""
	case pb.Language_LANGUAGE_GO:
		return enums.LanguageGo
	case pb.Language_LANGUAGE_PYTHON:
		return enums.LanguagePython
	case pb.Language_LANGUAGE_JAVASCRIPT:
		return enums.LanguageJavaScript
	case pb.Language_LANGUAGE_TYPESCRIPT:
		return enums.LanguageTypeScript
	case pb.Language_LANGUAGE_SQL:
		return enums.LanguageSQL
	default:
		return ""
	}
}

func languageToProtoEditor(l enums.Language) pb.Language {
	switch l {
	case enums.LanguageGo:
		return pb.Language_LANGUAGE_GO
	case enums.LanguagePython:
		return pb.Language_LANGUAGE_PYTHON
	case enums.LanguageJavaScript:
		return pb.Language_LANGUAGE_JAVASCRIPT
	case enums.LanguageTypeScript:
		return pb.Language_LANGUAGE_TYPESCRIPT
	case enums.LanguageSQL:
		return pb.Language_LANGUAGE_SQL
	default:
		return pb.Language_LANGUAGE_UNSPECIFIED
	}
}

func sectionToProtoEditor(s enums.Section) pb.Section {
	switch s {
	case enums.SectionAlgorithms:
		return pb.Section_SECTION_ALGORITHMS
	case enums.SectionSQL:
		return pb.Section_SECTION_SQL
	case enums.SectionGo:
		return pb.Section_SECTION_GO
	case enums.SectionSystemDesign:
		return pb.Section_SECTION_SYSTEM_DESIGN
	case enums.SectionBehavioral:
		return pb.Section_SECTION_BEHAVIORAL
	default:
		return pb.Section_SECTION_UNSPECIFIED
	}
}

func difficultyToProtoEditor(d enums.Difficulty) pb.Difficulty {
	switch d {
	case enums.DifficultyEasy:
		return pb.Difficulty_DIFFICULTY_EASY
	case enums.DifficultyMedium:
		return pb.Difficulty_DIFFICULTY_MEDIUM
	case enums.DifficultyHard:
		return pb.Difficulty_DIFFICULTY_HARD
	default:
		return pb.Difficulty_DIFFICULTY_UNSPECIFIED
	}
}

func editorRoleToProto(r enums.EditorRole) pb.EditorRole {
	switch r {
	case enums.EditorRoleOwner:
		return pb.EditorRole_EDITOR_ROLE_OWNER
	case enums.EditorRoleInterviewer:
		return pb.EditorRole_EDITOR_ROLE_INTERVIEWER
	case enums.EditorRoleParticipant:
		return pb.EditorRole_EDITOR_ROLE_PARTICIPANT
	case enums.EditorRoleViewer:
		return pb.EditorRole_EDITOR_ROLE_VIEWER
	default:
		return pb.EditorRole_EDITOR_ROLE_UNSPECIFIED
	}
}
