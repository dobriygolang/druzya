// Package ports — Connect-RPC handler for the quiz service.
//
// One implementation, two wire formats: native Connect at
// /druz9.v1.QuizService/* and REST at /api/v1/quiz/* via the vanguard
// transcoder mounted in cmd/monolith/services/quiz.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"druz9/quiz/app"
	"druz9/quiz/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

// Server bundles the quiz use cases and satisfies druz9v1connect.QuizServiceHandler.
type Server struct {
	Start  *app.StartSession
	Submit *app.SubmitSession
	Log    *slog.Logger
}

func (s *Server) StartSession(
	ctx context.Context,
	req *connect.Request[pb.StartQuizSessionRequest],
) (*connect.Response[pb.StartQuizSessionResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	src := domain.QuestionSource(req.Msg.Source)
	if !src.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("source must be codex, mock_interview, or mixed"))
	}
	out, err := s.Start.Do(ctx, app.StartSessionInput{
		UserID: uid,
		Source: src,
		Topic:  req.Msg.Topic,
		Count:  int(req.Msg.Count),
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("empty_pool"))
		}
		s.logErr(ctx, "start", err, uid)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	resp := &pb.StartQuizSessionResponse{
		SessionId: out.ID.String(),
		Source:    string(out.Source),
		ExpiresAt: out.ExpiresAt.Unix(),
		Questions: make([]*pb.QuizQuestion, 0, len(out.Questions)),
	}
	for _, q := range out.Questions {
		resp.Questions = append(resp.Questions, &pb.QuizQuestion{
			Id:          q.ID,
			Source:      string(q.Source),
			Topic:       q.Topic,
			QuestionMd:  q.QuestionMD,
			AnswerHint:  q.AnswerHint,
			ReadingLink: q.ReadingLink,
		})
	}
	return connect.NewResponse(resp), nil
}

func (s *Server) SubmitSession(
	ctx context.Context,
	req *connect.Request[pb.SubmitQuizSessionRequest],
) (*connect.Response[pb.SubmitQuizSessionResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.SessionId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_session_id"))
	}
	out, err := s.Submit.Do(ctx, app.SubmitSessionInput{
		UserID:    uid,
		SessionID: id,
		Answers:   req.Msg.Answers,
	})
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrSessionExpired):
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("session_expired"))
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		default:
			s.logErr(ctx, "submit", err, uid)
			return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
		}
	}
	resp := &pb.SubmitQuizSessionResponse{
		SessionId:  out.SessionID.String(),
		Source:     string(out.Source),
		Total:      int32(out.Total),
		Correct:    int32(out.Correct),
		Judgements: make([]*pb.QuizJudgement, 0, len(out.Judgements)),
	}
	for _, j := range out.Judgements {
		resp.Judgements = append(resp.Judgements, &pb.QuizJudgement{
			QuestionId:  j.QuestionID,
			Correct:     j.Correct,
			Explanation: j.Explanation,
		})
	}
	return connect.NewResponse(resp), nil
}

func (s *Server) logErr(ctx context.Context, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) || s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "quiz.connect",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
}
