// Package ports — Connect-RPC adapter for the lobby bounded context.
//
// One implementation, two wire formats: native Connect at
// /druz9.v1.LobbyService/* and REST at /api/v1/lobby/* via the vanguard
// transcoder mounted in cmd/monolith/services/circles.
package ports

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	"druz9/lobby/app"
	"druz9/lobby/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
)

// Server bundles lobby use cases and satisfies LobbyServiceHandler.
type Server struct {
	Create *app.CreateLobby
	List   *app.ListPublicLobbies
	Get    *app.GetLobby
	Join   *app.JoinLobby
	Leave  *app.LeaveLobby
	Start  *app.StartLobby
	Cancel *app.CancelLobby
	Log    *slog.Logger
}

var _ druz9v1connect.LobbyServiceHandler = (*Server)(nil)

// ── Discovery (anonymous) ───────────────────────────────────────────────

func (s *Server) ListLobbies(
	ctx context.Context,
	req *connect.Request[pb.ListLobbiesRequest],
) (*connect.Response[pb.ListLobbiesResponse], error) {
	f := domain.ListFilter{
		Visibility: domain.Visibility(strings.TrimSpace(req.Msg.Visibility)),
		Mode:       domain.Mode(strings.TrimSpace(req.Msg.Mode)),
		Section:    strings.TrimSpace(req.Msg.Section),
		Limit:      int(req.Msg.Limit),
	}
	out, err := s.List.Do(ctx, f)
	if err != nil {
		s.logErr(ctx, "ListLobbies", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	resp := &pb.ListLobbiesResponse{Items: make([]*pb.Lobby, 0, len(out))}
	for _, l := range out {
		resp.Items = append(resp.Items, lobbyToProto(l, 0))
	}
	return connect.NewResponse(resp), nil
}

func (s *Server) GetLobby(
	ctx context.Context,
	req *connect.Request[pb.GetLobbyRequest],
) (*connect.Response[pb.LobbyDetail], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid lobby id"))
	}
	view, err := s.Get.Do(ctx, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("lobby not found"))
		}
		s.logErr(ctx, "GetLobby", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(viewToProto(view)), nil
}

func (s *Server) GetLobbyByCode(
	ctx context.Context,
	req *connect.Request[pb.GetLobbyByCodeRequest],
) (*connect.Response[pb.LobbyDetail], error) {
	view, err := s.Get.DoByCode(ctx, req.Msg.Code)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("lobby not found"))
		case errors.Is(err, app.ErrInvalidInput):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.logErr(ctx, "GetLobbyByCode", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(viewToProto(view)), nil
}

// ── Mutations (auth required) ──────────────────────────────────────────

func (s *Server) CreateLobby(
	ctx context.Context,
	req *connect.Request[pb.CreateLobbyRequest],
) (*connect.Response[pb.Lobby], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	in := app.CreateLobbyInput{
		OwnerID:      uid,
		Mode:         domain.Mode(req.Msg.Mode),
		Section:      req.Msg.Section,
		Difficulty:   req.Msg.Difficulty,
		Visibility:   domain.Visibility(req.Msg.Visibility),
		MaxMembers:   int(req.Msg.MaxMembers),
		AIAllowed:    req.Msg.AiAllowed,
		TimeLimitMin: int(req.Msg.TimeLimitMin),
		SkillFilter:  req.Msg.SkillFilter,
	}
	l, err := s.Create.Do(ctx, in)
	if err != nil {
		switch {
		case errors.Is(err, app.ErrInvalidInput):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		case errors.Is(err, domain.ErrCodeExhausted):
			return nil, connect.NewError(connect.CodeResourceExhausted,
				errors.New("code generator exhausted"))
		}
		s.logErr(ctx, "CreateLobby", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(lobbyToProto(l, 1)), nil
}

func (s *Server) JoinLobby(
	ctx context.Context,
	req *connect.Request[pb.JoinLobbyRequest],
) (*connect.Response[pb.JoinLobbyResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid lobby id"))
	}
	l, err := s.Join.DoByID(ctx, id, uid)
	switch {
	case err == nil:
		return connect.NewResponse(&pb.JoinLobbyResponse{
			Status: "joined",
			Lobby:  lobbyToProto(l, 0),
		}), nil
	case errors.Is(err, domain.ErrNotFound):
		return nil, connect.NewError(connect.CodeNotFound, errors.New("lobby not found"))
	case errors.Is(err, domain.ErrAlreadyMember):
		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("already a member"))
	case errors.Is(err, domain.ErrFull):
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("lobby is full"))
	case errors.Is(err, domain.ErrClosed):
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("lobby is not open"))
	}
	s.logErr(ctx, "JoinLobby", err)
	return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
}

func (s *Server) LeaveLobby(
	ctx context.Context,
	req *connect.Request[pb.LeaveLobbyRequest],
) (*connect.Response[pb.LeaveLobbyResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid lobby id"))
	}
	res, err := s.Leave.Do(ctx, id, uid)
	if err == nil {
		return connect.NewResponse(&pb.LeaveLobbyResponse{
			Status:  res.Status,
			LobbyId: id.String(),
		}), nil
	}
	if errors.Is(err, domain.ErrNotFound) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("not a member"))
	}
	s.logErr(ctx, "LeaveLobby", err)
	return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
}

func (s *Server) StartLobby(
	ctx context.Context,
	req *connect.Request[pb.StartLobbyRequest],
) (*connect.Response[pb.StartLobbyResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid lobby id"))
	}
	l, err := s.Start.Do(ctx, id, uid)
	switch {
	case err == nil:
		return connect.NewResponse(&pb.StartLobbyResponse{
			Status: "started",
			Lobby:  lobbyToProto(l, 0),
		}), nil
	case errors.Is(err, domain.ErrNotFound):
		return nil, connect.NewError(connect.CodeNotFound, errors.New("lobby not found"))
	case errors.Is(err, domain.ErrForbidden):
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("only owner can start"))
	case errors.Is(err, domain.ErrClosed):
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("lobby not open"))
	case errors.Is(err, app.ErrInvalidInput):
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	s.logErr(ctx, "StartLobby", err)
	return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
}

func (s *Server) CancelLobby(
	ctx context.Context,
	req *connect.Request[pb.CancelLobbyRequest],
) (*connect.Response[pb.CancelLobbyResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid lobby id"))
	}
	switch err = s.Cancel.Do(ctx, id, uid); {
	case err == nil:
		return connect.NewResponse(&pb.CancelLobbyResponse{
			Status:  "cancelled",
			LobbyId: id.String(),
		}), nil
	case errors.Is(err, domain.ErrNotFound):
		return nil, connect.NewError(connect.CodeNotFound, errors.New("lobby not found"))
	case errors.Is(err, domain.ErrForbidden):
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("only owner can cancel"))
	case errors.Is(err, domain.ErrClosed):
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("lobby not open"))
	}
	s.logErr(ctx, "CancelLobby", err)
	return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
}

// ── helpers ─────────────────────────────────────────────────────────────

func (s *Server) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "lobby."+where, slog.Any("err", err))
}

func lobbyToProto(l domain.Lobby, members int) *pb.Lobby {
	out := &pb.Lobby{
		Id: l.ID.String(), Code: l.Code, OwnerId: l.OwnerID.String(),
		Mode: string(l.Mode), Section: l.Section, Difficulty: l.Difficulty,
		Visibility: string(l.Visibility), MaxMembers: int32(l.MaxMembers),
		AiAllowed: l.AIAllowed, TimeLimitMin: int32(l.TimeLimitMin),
		Status: string(l.Status), MembersCount: int32(members),
		SkillFilter: l.SkillFilter,
		CreatedAt:   timestamppb.New(l.CreatedAt.UTC()),
	}
	if l.MatchID != nil {
		out.MatchId = l.MatchID.String()
	}
	return out
}

func viewToProto(view domain.LobbyView) *pb.LobbyDetail {
	members := make([]*pb.LobbyMember, 0, len(view.Members))
	for _, m := range view.Members {
		members = append(members, &pb.LobbyMember{
			UserId:   m.UserID.String(),
			Role:     string(m.Role),
			Team:     int32(m.Team),
			JoinedAt: timestamppb.New(m.JoinedAt.UTC()),
		})
	}
	return &pb.LobbyDetail{
		Lobby:   lobbyToProto(view.Lobby, len(view.Members)),
		Members: members,
	}
}
