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
	out, err := s.H.CreatePipeline(ctx, uid, companyID, req.Msg.GetAiAssist())
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
	if err := s.checkPipelineOwner(ctx, pipelineID, uid); err != nil {
		return nil, err
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
	if err := s.checkPipelineOwner(ctx, stage.PipelineID, uid); err != nil {
		return nil, err
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
	if err := s.checkPipelineOwner(ctx, stage.PipelineID, uid); err != nil {
		return nil, err
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
