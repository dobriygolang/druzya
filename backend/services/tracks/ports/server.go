// Package ports — Connect-RPC adapter for the tracks bounded context.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	tracksApp "druz9/tracks/app"
	tracksDomain "druz9/tracks/domain"

	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
)

// Server adapts tracks use cases to Connect.
type Server struct {
	druz9v1connect.UnimplementedTracksServiceHandler

	List       *tracksApp.ListCatalog
	Get        *tracksApp.GetTrack
	ListUser   *tracksApp.ListUserTracks
	Join       *tracksApp.JoinTrack
	Advance    *tracksApp.AdvanceStep
	Pause      *tracksApp.PauseTrack
	Leave      *tracksApp.LeaveTrack
	CustomPath *tracksApp.GenerateCustomPath

	// Step UX. nil-safe.
	StartCheckpointUC  *tracksApp.StartCheckpoint
	SubmitCheckpointUC *tracksApp.SubmitCheckpoint

	Log *slog.Logger
}

// NewServer wires the adapter. Use cases must all be non-nil.
func NewServer(
	list *tracksApp.ListCatalog,
	get *tracksApp.GetTrack,
	listUser *tracksApp.ListUserTracks,
	join *tracksApp.JoinTrack,
	advance *tracksApp.AdvanceStep,
	pause *tracksApp.PauseTrack,
	leave *tracksApp.LeaveTrack,
	log *slog.Logger,
) *Server {
	if log == nil {
		panic("tracks/ports.NewServer: nil logger")
	}
	return &Server{
		List: list, Get: get, ListUser: listUser,
		Join: join, Advance: advance, Pause: pause, Leave: leave,
		Log: log,
	}
}

// ListTracks — public catalogue read.
func (s *Server) ListTracks(
	ctx context.Context,
	_ *connect.Request[pb.ListTracksRequest],
) (*connect.Response[pb.ListTracksResponse], error) {
	rows, err := s.List.Do(ctx)
	if err != nil {
		return nil, s.toConnectErr("ListTracks", err)
	}
	out := &pb.ListTracksResponse{Items: make([]*pb.LearningTrack, 0, len(rows))}
	for _, t := range rows {
		out.Items = append(out.Items, trackToProto(t))
	}
	return connect.NewResponse(out), nil
}

// GetTrack — single track + steps by slug.
func (s *Server) GetTrack(
	ctx context.Context,
	req *connect.Request[pb.GetTrackRequest],
) (*connect.Response[pb.GetTrackResponse], error) {
	tw, err := s.Get.Do(ctx, req.Msg.GetSlug())
	if err != nil {
		return nil, s.toConnectErr("GetTrack", err)
	}
	out := &pb.GetTrackResponse{
		Track: trackToProto(tw.Track),
		Steps: make([]*pb.TrackStep, 0, len(tw.Steps)),
	}
	for _, s := range tw.Steps {
		out.Steps = append(out.Steps, stepToProto(s))
	}
	return connect.NewResponse(out), nil
}

// ListUserTracks — current user's enrolments.
func (s *Server) ListUserTracks(
	ctx context.Context,
	_ *connect.Request[pb.ListUserTracksRequest],
) (*connect.Response[pb.ListUserTracksResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.ListUser.Do(ctx, uid)
	if err != nil {
		return nil, s.toConnectErr("ListUserTracks", err)
	}
	out := &pb.ListUserTracksResponse{Items: make([]*pb.LearningTrackProgress, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, &pb.LearningTrackProgress{
			Enrolment:  enrolmentToProto(r.UserTrack),
			Track:      trackToProto(r.Track),
			StepsTotal: int32(r.StepsTotal),
		})
	}
	return connect.NewResponse(out), nil
}

// JoinTrack — enrol or resume.
func (s *Server) JoinTrack(
	ctx context.Context,
	req *connect.Request[pb.JoinTrackRequest],
) (*connect.Response[pb.LearningTrackEnrolment], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, perr := uuid.Parse(req.Msg.GetTrackId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid track_id"))
	}
	out, err := s.Join.Do(ctx, tracksApp.JoinTrackInput{UserID: uid, TrackID: tid})
	if err != nil {
		return nil, s.toConnectErr("JoinTrack", err)
	}
	return connect.NewResponse(enrolmentToProto(out)), nil
}

// AdvanceStep — bump current_step.
func (s *Server) AdvanceStep(
	ctx context.Context,
	req *connect.Request[pb.AdvanceStepRequest],
) (*connect.Response[pb.LearningTrackEnrolment], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, perr := uuid.Parse(req.Msg.GetTrackId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid track_id"))
	}
	out, err := s.Advance.Do(ctx, tracksApp.AdvanceStepInput{UserID: uid, TrackID: tid})
	if err != nil {
		return nil, s.toConnectErr("AdvanceStep", err)
	}
	return connect.NewResponse(enrolmentToProto(out)), nil
}

// PauseTrack — set paused_at.
func (s *Server) PauseTrack(
	ctx context.Context,
	req *connect.Request[pb.PauseTrackRequest],
) (*connect.Response[pb.LearningTrackEnrolment], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, perr := uuid.Parse(req.Msg.GetTrackId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid track_id"))
	}
	out, err := s.Pause.Do(ctx, uid, tid)
	if err != nil {
		return nil, s.toConnectErr("PauseTrack", err)
	}
	return connect.NewResponse(enrolmentToProto(out)), nil
}

// LeaveTrack — drop the enrolment row.
func (s *Server) LeaveTrack(
	ctx context.Context,
	req *connect.Request[pb.LeaveTrackRequest],
) (*connect.Response[pb.LeaveTrackResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	tid, perr := uuid.Parse(req.Msg.GetTrackId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid track_id"))
	}
	if err := s.Leave.Do(ctx, uid, tid); err != nil {
		return nil, s.toConnectErr("LeaveTrack", err)
	}
	return connect.NewResponse(&pb.LeaveTrackResponse{Ok: true}), nil
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
	case errors.Is(err, tracksDomain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, tracksDomain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, tracksDomain.ErrAlreadyJoined):
		return connect.NewError(connect.CodeAlreadyExists, err)
	}
	if s.Log != nil {
		s.Log.ErrorContext(context.Background(), "tracks.ports."+op, slog.Any("err", err))
	}
	return connect.NewError(connect.CodeInternal, fmt.Errorf("internal"))
}

func trackToProto(t tracksDomain.Track) *pb.LearningTrack {
	out := &pb.LearningTrack{
		Id:             t.ID.String(),
		Slug:           t.Slug,
		Name:           t.Name,
		Tagline:        t.Tagline,
		DescriptionMd:  t.DescriptionMD,
		CoverImageUrl:  t.CoverImageURL,
		AccentColor:    t.AccentColor,
		EstimatedWeeks: int32(t.EstimatedWeeks),
		Difficulty:     string(t.Difficulty),
		IsCurated:      t.IsCurated,
		IsActive:       t.IsActive,
		Tags:           t.Tags,
		CompanyFocus:   t.CompanyFocus,
		CreatedAt:      timestamppb.New(t.CreatedAt.UTC()),
		UpdatedAt:      timestamppb.New(t.UpdatedAt.UTC()),
	}
	if t.CuratorID != nil {
		out.CuratorId = t.CuratorID.String()
	}
	return out
}

func stepToProto(s tracksDomain.Step) *pb.TrackStep {
	return &pb.TrackStep{
		TrackId:            s.TrackID.String(),
		StepIndex:          int32(s.StepIndex),
		Title:              s.Title,
		DescriptionMd:      s.DescriptionMD,
		SkillKeys:          s.SkillKeys,
		RequiredKind:       stepKindToProto(s.RequiredKind),
		RequiredCount:      int32(s.RequiredCount),
		RecommendedReading: s.RecommendedReading,
		EstimatedMinutes:   int32(s.EstimatedMinutes),
	}
}

func enrolmentToProto(u tracksDomain.UserTrack) *pb.LearningTrackEnrolment {
	out := &pb.LearningTrackEnrolment{
		UserId:      u.UserID.String(),
		TrackId:     u.TrackID.String(),
		JoinedAt:    timestamppb.New(u.JoinedAt.UTC()),
		CurrentStep: int32(u.CurrentStep),
	}
	if u.PausedAt != nil {
		out.PausedAt = timestamppb.New(u.PausedAt.UTC())
	}
	if u.CompletedAt != nil {
		out.CompletedAt = timestamppb.New(u.CompletedAt.UTC())
	}
	return out
}

func stepKindToProto(k tracksDomain.StepKind) pb.TrackStepKind {
	switch k {
	case tracksDomain.StepKindKata:
		return pb.TrackStepKind_TRACK_STEP_KIND_KATA
	case tracksDomain.StepKindMock:
		return pb.TrackStepKind_TRACK_STEP_KIND_MOCK
	case tracksDomain.StepKindCodexRead:
		return pb.TrackStepKind_TRACK_STEP_KIND_CODEX_READ
	case tracksDomain.StepKindFocusBlock:
		return pb.TrackStepKind_TRACK_STEP_KIND_FOCUS_BLOCK
	}
	return pb.TrackStepKind_TRACK_STEP_KIND_UNSPECIFIED
}

// GenerateCustomPath — onboarding custom-track flow. Auth required.
func (s *Server) GenerateCustomPath(
	ctx context.Context,
	req *connect.Request[pb.GenerateCustomPathRequest],
) (*connect.Response[pb.GenerateCustomPathResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	if s.CustomPath == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("custom path llm not wired"))
	}
	res, err := s.CustomPath.Do(ctx, tracksApp.GenerateCustomPathInput{Goal: req.Msg.Goal})
	if err != nil {
		return nil, s.toConnectErr("GenerateCustomPath", err)
	}
	out := &pb.GenerateCustomPathResponse{Nodes: make([]*pb.CustomPathNode, 0, len(res.Nodes))}
	for _, n := range res.Nodes {
		out.Nodes = append(out.Nodes, &pb.CustomPathNode{
			Id:    n.ID,
			Title: n.Title,
			Group: n.Group,
			Hint:  n.Hint,
		})
	}
	return connect.NewResponse(out), nil
}

// ── Step UX ──────────────────────────────────────────────────────────────

// StartCheckpoint — открыть checkpoint quiz CTA на step.
func (s *Server) StartCheckpoint(
	ctx context.Context,
	req *connect.Request[pb.StartCheckpointRequest],
) (*connect.Response[pb.StartCheckpointResponse], error) {
	if s.StartCheckpointUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("tracks.StartCheckpoint: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	trackID, err := uuid.Parse(req.Msg.GetTrackId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("track_id: %w", err))
	}
	out, err := s.StartCheckpointUC.Do(ctx, tracksApp.StartCheckpointInput{
		UserID: uid, TrackID: trackID, StepIndex: int(req.Msg.GetStepIndex()),
	})
	if err != nil {
		return nil, s.toConnectErr("StartCheckpoint", err)
	}
	return connect.NewResponse(&pb.StartCheckpointResponse{
		StepTitle:             out.Step.Title,
		SkillKeys:             out.Step.SkillKeys,
		CheckpointSkillKeys:   out.CheckpointSkills,
		AlreadyPassed:         out.AlreadyPassed,
		ReflectionRequired:    out.Step.ReflectionRequired,
		GraduationMockSection: out.Step.GraduationMockSection,
	}), nil
}

// SubmitCheckpoint — принять answers + grade через TaskCheckpointGrade.
func (s *Server) SubmitCheckpoint(
	ctx context.Context,
	req *connect.Request[pb.SubmitCheckpointRequest],
) (*connect.Response[pb.SubmitCheckpointResponse], error) {
	if s.SubmitCheckpointUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("tracks.SubmitCheckpoint: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	trackID, err := uuid.Parse(req.Msg.GetTrackId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("track_id: %w", err))
	}
	answers := make([]tracksApp.QuestionAnswer, 0, len(req.Msg.GetAnswers()))
	for _, a := range req.Msg.GetAnswers() {
		answers = append(answers, tracksApp.QuestionAnswer{
			QuestionID:  a.GetQuestionId(),
			Question:    a.GetQuestion(),
			UserAnswer:  a.GetUserAnswer(),
			ModelAnswer: a.GetModelAnswer(),
		})
	}
	out, err := s.SubmitCheckpointUC.Do(ctx, tracksApp.SubmitCheckpointInput{
		UserID: uid, TrackID: trackID, StepIndex: int(req.Msg.GetStepIndex()),
		Answers: answers,
	})
	if err != nil {
		return nil, s.toConnectErr("SubmitCheckpoint", err)
	}
	resp := &pb.SubmitCheckpointResponse{
		Score:     int32(out.Score),
		Passed:    out.Passed,
		AttemptId: out.Attempt.ID.String(),
	}
	for _, a := range out.Attempts {
		resp.Attempts = append(resp.Attempts, &pb.GradedAnswer{
			QuestionId:  a.QuestionID,
			UserAnswer:  a.UserAnswer,
			ModelAnswer: a.ModelAnswer,
			Correct:     a.Correct,
			Comment:     a.Comment,
		})
	}
	if out.Attempt.PassedAt != nil {
		resp.PassedAt = timestamppb.New(*out.Attempt.PassedAt)
	}
	return connect.NewResponse(resp), nil
}
