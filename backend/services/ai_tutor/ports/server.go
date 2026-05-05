// Package ports — Connect-RPC handler для AI-tutor.
//
// Mirror'ит pattern из services/tutor/ports/server.go: thin adapter
// который вызывает use-cases + конвертит domain↔proto + maps domain
// errors на Connect codes.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/ai_tutor/app"
	"druz9/ai_tutor/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

// Compile-time assertion.
var _ druz9v1connect.AITutorServiceHandler = (*Server)(nil)

type Server struct {
	Personas      domain.PersonaRepo
	Threads       domain.ThreadRepo
	Episodes      domain.EpisodeRepo
	AdoptUC       *app.AdoptAITutor
	SendUC        *app.SendMessage
	Log           *slog.Logger
}

func (s *Server) ListPersonas(
	ctx context.Context,
	_ *connect.Request[pb.ListAITutorPersonasRequest],
) (*connect.Response[pb.ListAITutorPersonasResponse], error) {
	rows, err := s.Personas.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.ListPersonas: %w", s.toConnectErr(err))
	}
	out := &pb.ListAITutorPersonasResponse{Items: make([]*pb.AITutorPersona, 0, len(rows))}
	for _, p := range rows {
		out.Items = append(out.Items, toPersonaProto(p))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) Adopt(
	ctx context.Context,
	req *connect.Request[pb.AdoptAITutorRequest],
) (*connect.Response[pb.AdoptAITutorResponse], error) {
	if s.AdoptUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("Adopt not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	res, err := s.AdoptUC.Do(ctx, app.AdoptInput{
		StudentID:   uid,
		PersonaSlug: req.Msg.PersonaSlug,
	})
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.Adopt: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.AdoptAITutorResponse{
		Persona: toPersonaProto(res.Persona),
		Thread:  toThreadProto(res.Thread),
	}), nil
}

func (s *Server) ListMyThreads(
	ctx context.Context,
	req *connect.Request[pb.ListMyAITutorThreadsRequest],
) (*connect.Response[pb.ListMyAITutorThreadsResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	rows, nextCursor, err := s.Threads.ListThreadsByStudentPaged(ctx, uid, int(req.Msg.GetLimit()), req.Msg.GetCursor())
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.ListMyThreads: %w", s.toConnectErr(err))
	}
	out := &pb.ListMyAITutorThreadsResponse{
		Items:      make([]*pb.AITutorThread, 0, len(rows)),
		NextCursor: nextCursor,
	}
	for _, t := range rows {
		out.Items = append(out.Items, toThreadProto(t))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) GetHistory(
	ctx context.Context,
	req *connect.Request[pb.GetAITutorHistoryRequest],
) (*connect.Response[pb.GetAITutorHistoryResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	threadID, err := uuid.Parse(req.Msg.ThreadId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("thread_id: %w", err))
	}
	thread, err := s.Threads.GetThreadByID(ctx, threadID)
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.GetHistory: %w", s.toConnectErr(err))
	}
	if thread.StudentID != uid {
		return nil, connect.NewError(connect.CodeNotFound, domain.ErrNotFound)
	}
	limit := int(req.Msg.Limit)
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	episodes, err := s.Episodes.ListRecent(ctx, threadID, limit)
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.GetHistory: episodes: %w", s.toConnectErr(err))
	}
	out := &pb.GetAITutorHistoryResponse{
		Thread:   toThreadProto(thread),
		Episodes: make([]*pb.AITutorEpisode, 0, len(episodes)),
	}
	for _, e := range episodes {
		out.Episodes = append(out.Episodes, toEpisodeProto(e))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) SendMessage(
	ctx context.Context,
	req *connect.Request[pb.SendAITutorMessageRequest],
) (*connect.Response[pb.SendAITutorMessageResponse], error) {
	if s.SendUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("SendMessage not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	threadID, err := uuid.Parse(req.Msg.ThreadId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("thread_id: %w", err))
	}
	res, err := s.SendUC.Do(ctx, app.SendMessageInput{
		StudentID:   uid,
		ThreadID:    threadID,
		Content:     req.Msg.Content,
		ContextNote: req.Msg.ContextNote,
	})
	if err != nil {
		return nil, fmt.Errorf("ai_tutor.SendMessage: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.SendAITutorMessageResponse{
		UserEpisode:      toEpisodeProto(res.UserEpisode),
		AssistantEpisode: toEpisodeProto(res.AssistantEpisode),
		Compacted:        res.Compacted,
	}), nil
}

// ── error mapping ──

func (s *Server) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrRateLimited):
		return connect.NewError(connect.CodeResourceExhausted, err)
	case errors.Is(err, domain.ErrAlreadyAdopted):
		return connect.NewError(connect.CodeAlreadyExists, err)
	default:
		if s.Log != nil {
			s.Log.Error("ai_tutor: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("ai_tutor failure"))
	}
}

// ── converters ──

func toPersonaProto(p domain.Persona) *pb.AITutorPersona {
	out := &pb.AITutorPersona{
		Id:             p.ID.String(),
		Slug:           p.Slug,
		DisplayName:    p.DisplayName,
		ScopeTrackKind: p.ScopeTrackKind,
		PacePerWeek:    int32(p.PacePerWeek),
		Active:         p.Active,
	}
	if p.AIUserID != nil {
		out.AiUserId = p.AIUserID.String()
	}
	return out
}

func toThreadProto(t domain.Thread) *pb.AITutorThread {
	out := &pb.AITutorThread{
		Id:             t.ID.String(),
		StudentId:      t.StudentID.String(),
		PersonaId:      t.PersonaID.String(),
		SummaryMd:      t.SummaryMD,
		MessageCount:   int32(t.MessageCount),
		DailyMsgCount:  int32(t.DailyMsgCount),
	}
	if !t.CreatedAt.IsZero() {
		out.CreatedAt = t.CreatedAt.Format(time.RFC3339)
	}
	if !t.UpdatedAt.IsZero() {
		out.UpdatedAt = t.UpdatedAt.Format(time.RFC3339)
	}
	return out
}

func toEpisodeProto(e domain.Episode) *pb.AITutorEpisode {
	out := &pb.AITutorEpisode{
		Id:        e.ID.String(),
		ThreadId:  e.ThreadID.String(),
		Role:      string(e.Role),
		Content:   e.Content,
		ModelUsed: e.ModelUsed,
		TokensIn:  int32(e.TokensIn),
		TokensOut: int32(e.TokensOut),
	}
	if !e.OccurredAt.IsZero() {
		out.OccurredAt = e.OccurredAt.Format(time.RFC3339)
	}
	return out
}
