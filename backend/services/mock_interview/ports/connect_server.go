// connect_server.go — Connect-RPC adapter для public read endpoints
// mock_interview сервиса. Часть постепенной chi→proto миграции
// (37 endpoints всего; здесь — 4 read-only public). Mutating + admin
// surfaces остаются на chi handlers в http.go до следующих passes.
//
// Why split: caller wiring остаётся одним Server'ом (h.go + connect_server.go
// — same struct, разные методы). Vanguard transcoder mounted в
// cmd/monolith/services/mock_interview/ ловит REST aliases на одинаковые
// /api/v1/mock/* paths, а chi-handler'ы на тех же paths удалены из Mount()
// одновременно с регистрацией — без overlap.
package ports

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"druz9/mock_interview/app"
	"druz9/mock_interview/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
)

// Compile-time guard.
var _ druz9v1connect.MockPipelineServiceHandler = (*Server)(nil)

// ListCompanies — public каталог активных компаний.
func (s *Server) ListCompanies(
	ctx context.Context,
	_ *connect.Request[pb.ListMockCompaniesRequest],
) (*connect.Response[pb.ListMockCompaniesResponse], error) {
	if _, err := s.requireUserConnect(ctx); err != nil {
		return nil, err
	}
	cs, err := s.H.ListCompanies(ctx, true) // active only
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.ListMockCompaniesResponse{Items: make([]*pb.PipelineCompany, 0, len(cs))}
	for _, c := range cs {
		out.Items = append(out.Items, companyAdminToProto(c))
	}
	return connect.NewResponse(out), nil
}

// GetPipeline — детали pipeline'а с проверкой ownership.
func (s *Server) GetPipeline(
	ctx context.Context,
	req *connect.Request[pb.GetMockPipelineRequest],
) (*connect.Response[pb.MockPipeline], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	out, err := s.H.GetPipeline(ctx, id)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if out.Pipeline.UserID != uid {
		// Hide existence — same semantics as chi handler.
		return nil, connect.NewError(connect.CodeNotFound, errors.New("not found"))
	}
	return connect.NewResponse(pipelineToProto(out.Pipeline)), nil
}

// ListPipelines — pipeline'ы текущего юзера.
func (s *Server) ListPipelines(
	ctx context.Context,
	req *connect.Request[pb.ListMockPipelinesRequest],
) (*connect.Response[pb.ListMockPipelinesResponse], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	limit := int(req.Msg.GetLimit())
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	ps, err := s.H.ListPipelinesByUser(ctx, uid, limit)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.ListMockPipelinesResponse{Items: make([]*pb.MockPipeline, 0, len(ps))}
	for _, p := range ps {
		out.Items = append(out.Items, pipelineToProto(p))
	}
	return connect.NewResponse(out), nil
}

// CreatePipeline — заводит новый pipeline для текущего юзера.
func (s *Server) CreatePipeline(
	ctx context.Context,
	req *connect.Request[pb.CreateMockPipelineRequest],
) (*connect.Response[pb.MockPipeline], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	var companyID *uuid.UUID
	if v := req.Msg.GetCompanyId(); v != "" {
		cid, perr := uuid.Parse(v)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid company_id"))
		}
		companyID = &cid
	}
	// Phase 1.6 — sections are an optional allow-list (HR / algo / coding
	// / sysdesign / behavioral). Empty wire → full pipeline.
	rawSections := req.Msg.GetSections()
	sections := make([]domain.StageKind, 0, len(rawSections))
	for _, s := range rawSections {
		sections = append(sections, domain.StageKind(s))
	}
	out, err := s.H.CreatePipeline(ctx, uid, companyID, req.Msg.GetAiAssist(), sections)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(pipelineToProto(out.Pipeline)), nil
}

// CancelPipeline — отменяет pipeline (verdict=cancelled).
func (s *Server) CancelPipeline(
	ctx context.Context,
	req *connect.Request[pb.CancelMockPipelineRequest],
) (*connect.Response[emptypb.Empty], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.Orch == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("orchestrator not configured"))
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if cerr := s.Orch.CancelPipeline(ctx, id, uid); cerr != nil {
		return nil, s.toConnectErr(cerr)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AttemptFinalised — light-weight проверка "уже отправлено" для canvas-tab.
// Walks attempt → stage → pipeline → ownership; non-owners получают NotFound
// без leak'а existence (mirror chi-handler semantics).
func (s *Server) AttemptFinalised(
	ctx context.Context,
	req *connect.Request[pb.AttemptFinalisedRequest],
) (*connect.Response[pb.AttemptFinalisedResponse], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	attemptID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	att, err := s.H.Attempts.Get(ctx, attemptID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	stage, err := s.H.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	pipe, err := s.H.Pipelines.Get(ctx, stage.PipelineID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if pipe.UserID != uid {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("not found"))
	}
	finalised := att.AIVerdict != domain.AttemptVerdictPending
	return connect.NewResponse(&pb.AttemptFinalisedResponse{
		Finalised: finalised,
		Verdict:   attemptVerdictToProto(att.AIVerdict),
	}), nil
}

// StartNextStage — orchestrator: создаёт следующую stage + первую попытку.
func (s *Server) StartNextStage(
	ctx context.Context,
	req *connect.Request[pb.StartNextStageRequest],
) (*connect.Response[pb.StageWithAttempts], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.Orch == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("orchestrator not configured"))
	}
	pipelineID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if oerr := s.checkPipelineOwner(ctx, pipelineID, uid); oerr != nil {
		return nil, oerr
	}
	out, err := s.Orch.StartNextStage(ctx, pipelineID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(stageWithAttemptsToProto(out)), nil
}

// SubmitAnswer — orchestrator: фиксирует user_answer + триггерит AI-оценку.
func (s *Server) SubmitAnswer(
	ctx context.Context,
	req *connect.Request[pb.SubmitAnswerRequest],
) (*connect.Response[pb.PipelineAttempt], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.Orch == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("orchestrator not configured"))
	}
	attemptID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	att, err := s.H.Attempts.Get(ctx, attemptID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	stage, err := s.H.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if oerr := s.checkPipelineOwner(ctx, stage.PipelineID, uid); oerr != nil {
		return nil, oerr
	}
	out, err := s.Orch.SubmitAnswer(ctx, attemptID, req.Msg.GetUserAnswerMd())
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	// Question body / criteria не присоединяем (mirror chi shape).
	return connect.NewResponse(attemptToProto(out, "", "", nil, "", "", false)), nil
}

// FinishStage — orchestrator: закрывает stage (manual для HR / Soft).
func (s *Server) FinishStage(
	ctx context.Context,
	req *connect.Request[pb.FinishStageRequest],
) (*connect.Response[pb.PipelineStage], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.Orch == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("orchestrator not configured"))
	}
	stageID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	stage, err := s.H.PipelineStages.Get(ctx, stageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if oerr := s.checkPipelineOwner(ctx, stage.PipelineID, uid); oerr != nil {
		return nil, oerr
	}
	out, err := s.Orch.FinishStage(ctx, stageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(pipelineStageToProto(out)), nil
}

// checkPipelineOwner — Connect-version of requirePipelineOwner.
func (s *Server) checkPipelineOwner(ctx context.Context, pipelineID, uid uuid.UUID) error {
	p, err := s.H.Pipelines.Get(ctx, pipelineID)
	if err != nil {
		return s.toConnectErr(err)
	}
	if p.UserID != uid {
		return connect.NewError(connect.CodeNotFound, errors.New("not found"))
	}
	return nil
}

// RunAlgoAttempt — Algo «Run tests» dry-run. Executes the candidate's code
// against Judge0 sandboxed test-cases and returns per-case verdict WITHOUT
// touching pipeline_attempts. Final scoring still flows through SubmitAnswer.
func (s *Server) RunAlgoAttempt(
	ctx context.Context,
	req *connect.Request[pb.RunAlgoAttemptRequest],
) (*connect.Response[pb.AlgoVerdict], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.AlgoGrader == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("algo grader not configured"))
	}
	attemptID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	att, err := s.H.Attempts.Get(ctx, attemptID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	stage, err := s.H.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if oerr := s.checkPipelineOwner(ctx, stage.PipelineID, uid); oerr != nil {
		return nil, oerr
	}
	out, err := s.AlgoGrader.Run(ctx, app.RunAlgoInput{
		AttemptID: attemptID,
		Code:      req.Msg.GetCode(),
		Language:  req.Msg.GetLanguage(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(algoVerdictToProto(out)), nil
}

// RunCodingAttempt — Coding stage rubric grader. Open-ended LLM scoring
// (1..5) + strengths/weaknesses lists, NO sandbox call. Hidden behind a
// CodeUnavailable check when the grader isn't wired (e.g. nil LLM chain).
func (s *Server) RunCodingAttempt(
	ctx context.Context,
	req *connect.Request[pb.RunCodingAttemptRequest],
) (*connect.Response[pb.CodingVerdict], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.CodingGrader == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("coding grader not configured"))
	}
	attemptID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	att, err := s.H.Attempts.Get(ctx, attemptID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	stage, err := s.H.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if oerr := s.checkPipelineOwner(ctx, stage.PipelineID, uid); oerr != nil {
		return nil, oerr
	}
	out, err := s.CodingGrader.Run(ctx, app.CodingRubricInput{
		AttemptID: attemptID,
		Code:      req.Msg.GetCode(),
		Language:  req.Msg.GetLanguage(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(codingVerdictToProto(out)), nil
}

// RunSysDesignAttempt — SysDesign 5-axis rubric. Text-only (no vision call);
// pairs with SubmitCanvas (which IS vision-based) so the candidate can
// iterate cheaply.
func (s *Server) RunSysDesignAttempt(
	ctx context.Context,
	req *connect.Request[pb.RunSysDesignAttemptRequest],
) (*connect.Response[pb.SysDesignVerdict], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.SysDesignGrader == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("sysdesign grader not configured"))
	}
	attemptID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	att, err := s.H.Attempts.Get(ctx, attemptID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	stage, err := s.H.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if oerr := s.checkPipelineOwner(ctx, stage.PipelineID, uid); oerr != nil {
		return nil, oerr
	}
	out, err := s.SysDesignGrader.Run(ctx, app.SysDesignRubricInput{
		AttemptID:     attemptID,
		CanvasJSON:    req.Msg.GetCanvasJson(),
		NarrationText: req.Msg.GetNarrationText(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(sysDesignVerdictToProto(out)), nil
}

// RunBehavioralAttempt — STAR rubric for behavioral answers. Text-in,
// 4-axis-out + communication clarity score.
func (s *Server) RunBehavioralAttempt(
	ctx context.Context,
	req *connect.Request[pb.RunBehavioralAttemptRequest],
) (*connect.Response[pb.BehavioralVerdict], error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return nil, err
	}
	if s.BehavioralGrader == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("behavioral grader not configured"))
	}
	attemptID, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	att, err := s.H.Attempts.Get(ctx, attemptID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	stage, err := s.H.PipelineStages.Get(ctx, att.PipelineStageID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	if oerr := s.checkPipelineOwner(ctx, stage.PipelineID, uid); oerr != nil {
		return nil, oerr
	}
	out, err := s.BehavioralGrader.Run(ctx, app.BehavioralRubricInput{
		AttemptID:  attemptID,
		AnswerText: req.Msg.GetAnswerText(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(behavioralVerdictToProto(out)), nil
}

func codingVerdictToProto(out app.CodingRubricOutput) *pb.CodingVerdict {
	lines := make([]int32, 0, len(out.SuggestedLines))
	for _, n := range out.SuggestedLines {
		lines = append(lines, int32(n))
	}
	strengths := out.Strengths
	if strengths == nil {
		strengths = []string{}
	}
	weaknesses := out.Weaknesses
	if weaknesses == nil {
		weaknesses = []string{}
	}
	return &pb.CodingVerdict{
		Score:          int32(out.Score),
		Strengths:      strengths,
		Weaknesses:     weaknesses,
		SuggestedLines: lines,
		RubricMd:       out.RubricMD,
		Unavailable:    out.Unavailable,
	}
}

func sysDesignVerdictToProto(out app.SysDesignRubricOutput) *pb.SysDesignVerdict {
	missing := out.MissingConcepts
	if missing == nil {
		missing = []string{}
	}
	return &pb.SysDesignVerdict{
		Axes: &pb.SysDesignAxes{
			Availability: int32(out.Axes.Availability),
			Consistency:  int32(out.Axes.Consistency),
			Scalability:  int32(out.Axes.Scalability),
			Cost:         int32(out.Axes.Cost),
			Simplicity:   int32(out.Axes.Simplicity),
		},
		NarrativeCritique: out.NarrativeCritique,
		MissingConcepts:   missing,
		Unavailable:       out.Unavailable,
	}
}

func behavioralVerdictToProto(out app.BehavioralRubricOutput) *pb.BehavioralVerdict {
	return &pb.BehavioralVerdict{
		Axes: &pb.BehavioralAxes{
			Situation: int32(out.Axes.Situation),
			Task:      int32(out.Axes.Task),
			Action:    int32(out.Axes.Action),
			Result:    int32(out.Axes.Result),
		},
		CommunicationScore: int32(out.CommunicationScore),
		BodyMd:             out.BodyMD,
		Unavailable:        out.Unavailable,
	}
}

func algoVerdictToProto(out app.RunAlgoOutput) *pb.AlgoVerdict {
	tests := make([]*pb.AlgoTestResult, 0, len(out.Tests))
	for _, t := range out.Tests {
		tests = append(tests, &pb.AlgoTestResult{
			Ordinal:        int32(t.Ordinal),
			Passed:         t.Passed,
			Input:          t.Input,
			ExpectedOutput: t.Expected,
			ActualOutput:   t.Actual,
			Stderr:         t.Stderr,
			IsHidden:       t.IsHidden,
			RuntimeMs:      int32(t.RuntimeMs),
		})
	}
	return &pb.AlgoVerdict{
		Passed:             int32(out.Passed),
		Total:              int32(out.Total),
		RuntimeMs:          int32(out.RuntimeMs),
		MemoryKb:           int32(out.MemoryKB),
		SandboxUnavailable: out.SandboxUnavailable,
		Status:             string(out.Status),
		Tests:              tests,
	}
}

// ── stage / attempt mappers ─────────────────────────────────────────────

func pipelineStageToProto(s domain.PipelineStage) *pb.PipelineStage {
	out := &pb.PipelineStage{
		Id:           s.ID.String(),
		StageKind:    string(s.StageKind),
		Ordinal:      int32(s.Ordinal),
		Status:       string(s.Status),
		AiFeedbackMd: s.AIFeedbackMD,
	}
	if s.Score != nil {
		out.HasScore = true
		out.Score = *s.Score
	}
	if s.Verdict != nil {
		out.Verdict = string(*s.Verdict)
	}
	if s.AIStrictnessProfileID != nil {
		out.AiStrictnessProfileId = s.AIStrictnessProfileID.String()
	}
	if s.StartedAt != nil {
		out.StartedAt = timestamppb.New(s.StartedAt.UTC())
	}
	if s.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(s.FinishedAt.UTC())
	}
	return out
}

func referenceCriteriaToProto(rc domain.ReferenceCriteria) *pb.ReferenceCriteria {
	mm := rc.MustMention
	if mm == nil {
		mm = []string{}
	}
	nh := rc.NiceToHave
	if nh == nil {
		nh = []string{}
	}
	cp := rc.CommonPitfalls
	if cp == nil {
		cp = []string{}
	}
	return &pb.ReferenceCriteria{
		MustMention:    mm,
		NiceToHave:     nh,
		CommonPitfalls: cp,
	}
}

func attemptToProto(
	a domain.PipelineAttempt,
	qBody, qExpected string,
	rc *domain.ReferenceCriteria,
	taskFR, taskLang string,
	hasTaskFields bool,
) *pb.PipelineAttempt {
	missing := a.AIMissingPoints
	if missing == nil {
		missing = []string{}
	}
	var rcProto *pb.ReferenceCriteria
	if rc != nil {
		rcProto = referenceCriteriaToProto(*rc)
	} else {
		rcProto = referenceCriteriaToProto(domain.ReferenceCriteria{})
	}
	out := &pb.PipelineAttempt{
		Id:                     a.ID.String(),
		Kind:                   string(a.Kind),
		QuestionBody:           qBody,
		ExpectedAnswerMd:       qExpected,
		ReferenceCriteria:      rcProto,
		UserAnswerMd:           a.UserAnswerMD,
		UserContextMd:          a.UserContextMD,
		UserExcalidrawImageUrl: a.UserExcalidrawImageURL,
		AiVerdict:              attemptVerdictToProto(a.AIVerdict),
		AiFeedbackMd:           a.AIFeedbackMD,
		AiMissingPoints:        missing,
		CreatedAt:              timestamppb.New(a.CreatedAt.UTC()),
	}
	if len(a.UserExcalidrawSceneJSON) > 0 {
		out.UserExcalidrawSceneJson = string(a.UserExcalidrawSceneJSON)
	}
	if a.AIScore != nil {
		out.HasAiScore = true
		out.AiScore = *a.AIScore
	}
	if a.AIWaterScore != nil {
		out.HasAiWaterScore = true
		out.AiWaterScore = *a.AIWaterScore
	}
	if a.AIJudgedAt != nil {
		out.AiJudgedAt = timestamppb.New(a.AIJudgedAt.UTC())
	}
	if hasTaskFields {
		out.TaskFunctionalRequirementsMd = taskFR
		out.TaskLanguage = taskLang
	}
	return out
}

func stageWithAttemptsToProto(sw app.StageWithAttempts) *pb.StageWithAttempts {
	out := &pb.StageWithAttempts{
		Stage:    pipelineStageToProto(sw.Stage),
		Attempts: make([]*pb.PipelineAttempt, 0, len(sw.Attempts)),
	}
	for _, av := range sw.Attempts {
		rc := av.ReferenceCriteria
		hasTask := av.Attempt.TaskID != nil
		out.Attempts = append(out.Attempts, attemptToProto(
			av.Attempt, av.QuestionBody, av.ExpectedAnswerMD, &rc,
			av.TaskFunctionalRequirementsMD, av.TaskLanguage, hasTask,
		))
	}
	return out
}

func attemptVerdictToProto(v domain.AttemptVerdict) pb.MockAttemptVerdict {
	switch v {
	case domain.AttemptVerdictPending:
		return pb.MockAttemptVerdict_MOCK_ATTEMPT_VERDICT_PENDING
	case domain.AttemptVerdictPass:
		return pb.MockAttemptVerdict_MOCK_ATTEMPT_VERDICT_PASS
	case domain.AttemptVerdictFail:
		return pb.MockAttemptVerdict_MOCK_ATTEMPT_VERDICT_FAIL
	case domain.AttemptVerdictBorderline:
		// Proto enum пока не имеет BORDERLINE — маппим в FAIL чтобы caller
		// в strict-режиме воспринял как «не прошёл». TODO: добавить
		// MOCK_ATTEMPT_VERDICT_BORDERLINE в proto и переключить.
		return pb.MockAttemptVerdict_MOCK_ATTEMPT_VERDICT_FAIL
	default:
		return pb.MockAttemptVerdict_MOCK_ATTEMPT_VERDICT_UNSPECIFIED
	}
}

// GetLeaderboard — top-N с fairness watermark.
func (s *Server) GetLeaderboard(
	ctx context.Context,
	req *connect.Request[pb.GetMockLeaderboardRequest],
) (*connect.Response[pb.GetMockLeaderboardResponse], error) {
	if _, err := s.requireUserConnect(ctx); err != nil {
		return nil, err
	}
	limit := int(req.Msg.GetLimit())
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var companyID *uuid.UUID
	if v := req.Msg.GetCompanyId(); v != "" {
		id, perr := uuid.Parse(v)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("company_id: invalid uuid"))
		}
		companyID = &id
	}
	entries, err := s.H.GetLeaderboard(ctx, companyID, limit)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.GetMockLeaderboardResponse{
		Items:             make([]*pb.MockLeaderboardEntry, 0, len(entries)),
		FairnessWatermark: string(domain.FairnessAIAssistOffOnly),
	}
	for i, e := range entries {
		out.Items = append(out.Items, &pb.MockLeaderboardEntry{
			Rank:              int32(i + 1),
			UserId:            e.UserID.String(),
			DisplayName:       e.DisplayName,
			AvatarUrl:         e.AvatarURL,
			PipelinesFinished: int32(e.PipelinesFinished),
			PipelinesPassed:   int32(e.PipelinesPassed),
			AvgScore:          e.AvgScore,
		})
	}
	return connect.NewResponse(out), nil
}

// ── helpers ─────────────────────────────────────────────────────────────

// requireUserConnect — Connect-flavour сосед requireUser в http.go.
// Возвращает typed CodeUnauthenticated вместо writeErr на ResponseWriter.
func (s *Server) requireUserConnect(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func (s *Server) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrValidation):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrConflict):
		return connect.NewError(connect.CodeAborted, err)
	default:
		if s.Log != nil {
			s.Log.Error("mock_interview: unexpected error", "err", err)
		}
		return connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
}

func pipelineVerdictToProto(v domain.PipelineVerdict) pb.MockPipelineVerdict {
	switch v {
	case domain.PipelineInProgress:
		return pb.MockPipelineVerdict_MOCK_PIPELINE_VERDICT_IN_PROGRESS
	case domain.PipelinePass:
		return pb.MockPipelineVerdict_MOCK_PIPELINE_VERDICT_PASS
	case domain.PipelineFail:
		return pb.MockPipelineVerdict_MOCK_PIPELINE_VERDICT_FAIL
	case domain.PipelineCancelled:
		return pb.MockPipelineVerdict_MOCK_PIPELINE_VERDICT_CANCELLED
	default:
		return pb.MockPipelineVerdict_MOCK_PIPELINE_VERDICT_UNSPECIFIED
	}
}

func pipelineToProto(p domain.MockPipeline) *pb.MockPipeline {
	out := &pb.MockPipeline{
		Id:              p.ID.String(),
		UserId:          p.UserID.String(),
		AiAssist:        p.AIAssist,
		CurrentStageIdx: int32(p.CurrentStageIdx),
		Verdict:         pipelineVerdictToProto(p.Verdict),
	}
	if p.CompanyID != nil {
		out.CompanyId = p.CompanyID.String()
	}
	if p.TotalScore != nil {
		out.HasTotalScore = true
		out.TotalScore = *p.TotalScore
	}
	if !p.StartedAt.IsZero() {
		out.StartedAt = timestamppb.New(p.StartedAt.UTC())
	}
	if p.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(p.FinishedAt.UTC())
	}
	return out
}
