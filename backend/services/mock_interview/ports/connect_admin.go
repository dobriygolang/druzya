// connect_admin.go — admin Connect handlers (Phase chi→proto slice 4+).
//
// Парный файл к connect_server.go: public surfaces там, admin здесь.
// requireAdminConnect ловит missing/wrong role-claim как
// CodePermissionDenied (mirror chi's 403). Все Update'ы через PATCH +
// vanguard transcoder.
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
	sharedMw "druz9/shared/pkg/middleware"
)

// requireAdminConnect — admin-claim guard. Возвращает CodePermissionDenied
// если auth-middleware не положила role=admin в context. Симметрия с
// chi-handler'ной requireAdmin (см. server.go:53).
func (s *Server) requireAdminConnect(ctx context.Context) (uuid.UUID, error) {
	uid, err := s.requireUserConnect(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	role, rok := sharedMw.UserRoleFromContext(ctx)
	if !rok || role != adminRoleClaim {
		return uuid.Nil, connect.NewError(connect.CodePermissionDenied, errors.New("admin role required"))
	}
	return uid, nil
}

// ── admin: companies ───────────────────────────────────────────────────

func (s *Server) AdminListCompanies(
	ctx context.Context,
	req *connect.Request[pb.AdminListMockCompaniesRequest],
) (*connect.Response[pb.AdminListMockCompaniesResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	cs, err := s.H.ListCompanies(ctx, req.Msg.GetActiveOnly())
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminListMockCompaniesResponse{Items: make([]*pb.PipelineCompany, 0, len(cs))}
	for _, c := range cs {
		out.Items = append(out.Items, companyAdminToProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) AdminCreateCompany(
	ctx context.Context,
	req *connect.Request[pb.AdminCreateMockCompanyRequest],
) (*connect.Response[pb.PipelineCompany], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	in := req.Msg.GetCompany()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("company is required"))
	}
	out, err := s.H.CreateCompany(ctx, companyFromProtoInput(in, uuid.Nil))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(companyAdminToProto(out)), nil
}

func (s *Server) AdminUpdateCompany(
	ctx context.Context,
	req *connect.Request[pb.AdminUpdateMockCompanyRequest],
) (*connect.Response[pb.PipelineCompany], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	in := req.Msg.GetCompany()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("company is required"))
	}
	out, err := s.H.UpdateCompany(ctx, companyFromProtoInput(in, id))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(companyAdminToProto(out)), nil
}

func (s *Server) AdminToggleCompanyActive(
	ctx context.Context,
	req *connect.Request[pb.AdminToggleMockCompanyActiveRequest],
) (*connect.Response[emptypb.Empty], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.H.SetCompanyActive(ctx, id, req.Msg.GetActive()); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ── admin: strictness ───────────────────────────────────────────────────

func (s *Server) AdminListStrictness(
	ctx context.Context,
	req *connect.Request[pb.AdminListStrictnessRequest],
) (*connect.Response[pb.AdminListStrictnessResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	ps, err := s.H.ListStrictness(ctx, req.Msg.GetActiveOnly())
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminListStrictnessResponse{Items: make([]*pb.AIStrictnessProfile, 0, len(ps))}
	for _, p := range ps {
		out.Items = append(out.Items, strictnessToProto(p))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) AdminCreateStrictness(
	ctx context.Context,
	req *connect.Request[pb.AdminCreateStrictnessRequest],
) (*connect.Response[pb.AIStrictnessProfile], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	in := req.Msg.GetProfile()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("profile is required"))
	}
	out, err := s.H.CreateStrictness(ctx, strictnessFromProtoInput(in, uuid.Nil))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(strictnessToProto(out)), nil
}

func (s *Server) AdminUpdateStrictness(
	ctx context.Context,
	req *connect.Request[pb.AdminUpdateStrictnessRequest],
) (*connect.Response[pb.AIStrictnessProfile], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	in := req.Msg.GetProfile()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("profile is required"))
	}
	out, err := s.H.UpdateStrictness(ctx, strictnessFromProtoInput(in, id))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(strictnessToProto(out)), nil
}

// ── mappers ─────────────────────────────────────────────────────────────

// companyAdminToProto — full-shape company (используется и admin'ом, и
// public ListCompanies — поля те же).
func companyAdminToProto(c domain.Company) *pb.PipelineCompany {
	sections := c.Sections
	if sections == nil {
		sections = []string{}
	}
	out := &pb.PipelineCompany{
		Id:               c.ID.String(),
		Name:             c.Name,
		LogoUrl:          c.LogoURL,
		Active:           c.Active,
		Slug:             c.Slug,
		Difficulty:       c.Difficulty,
		MinLevelRequired: int32(c.MinLevelRequired),
		Sections:         sections,
		Description:      c.Description,
		SortOrder:        int32(c.SortOrder),
	}
	if !c.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(c.CreatedAt.UTC())
	}
	if !c.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(c.UpdatedAt.UTC())
	}
	return out
}

func companyFromProtoInput(in *pb.MockCompanyInput, id uuid.UUID) domain.Company {
	sections := in.GetSections()
	if sections == nil {
		sections = []string{}
	}
	return domain.Company{
		ID:               id,
		Slug:             in.GetSlug(),
		Name:             in.GetName(),
		Difficulty:       in.GetDifficulty(),
		MinLevelRequired: int(in.GetMinLevelRequired()),
		Sections:         sections,
		LogoURL:          in.GetLogoUrl(),
		Description:      in.GetDescription(),
		Active:           in.GetActive(),
		SortOrder:        int(in.GetSortOrder()),
	}
}

func strictnessToProto(p domain.AIStrictnessProfile) *pb.AIStrictnessProfile {
	out := &pb.AIStrictnessProfile{
		Id:                   p.ID.String(),
		Slug:                 p.Slug,
		Name:                 p.Name,
		OffTopicPenalty:      p.OffTopicPenalty,
		MustMentionPenalty:   p.MustMentionPenalty,
		HallucinationPenalty: p.HallucinationPenalty,
		BiasTowardFail:       p.BiasTowardFail,
		CustomPromptTemplate: p.CustomPromptTemplate,
		Active:               p.Active,
	}
	if !p.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(p.CreatedAt.UTC())
	}
	if !p.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(p.UpdatedAt.UTC())
	}
	return out
}

func strictnessFromProtoInput(in *pb.MockStrictnessInput, id uuid.UUID) domain.AIStrictnessProfile {
	return domain.AIStrictnessProfile{
		ID:                   id,
		Slug:                 in.GetSlug(),
		Name:                 in.GetName(),
		OffTopicPenalty:      in.GetOffTopicPenalty(),
		MustMentionPenalty:   in.GetMustMentionPenalty(),
		HallucinationPenalty: in.GetHallucinationPenalty(),
		BiasTowardFail:       in.GetBiasTowardFail(),
		CustomPromptTemplate: in.GetCustomPromptTemplate(),
		Active:               in.GetActive(),
	}
}

// ── admin: tasks ────────────────────────────────────────────────────────

func (s *Server) AdminListTasks(
	ctx context.Context,
	req *connect.Request[pb.AdminListMockTasksRequest],
) (*connect.Response[pb.AdminListMockTasksResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	f := domain.TaskFilter{
		StageKind:  domain.StageKind(req.Msg.GetStageKind()),
		Language:   domain.TaskLanguage(req.Msg.GetLanguage()),
		OnlyActive: req.Msg.GetOnlyActive(),
	}
	ts, err := s.H.ListTasks(ctx, f)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminListMockTasksResponse{Items: make([]*pb.MockTask, 0, len(ts))}
	for _, t := range ts {
		out.Items = append(out.Items, mockTaskToProto(t))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) AdminGetTask(
	ctx context.Context,
	req *connect.Request[pb.AdminGetMockTaskRequest],
) (*connect.Response[pb.AdminGetMockTaskResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	tw, err := s.H.GetTaskWithQuestions(ctx, id)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminGetMockTaskResponse{
		Task:      mockTaskToProto(tw.Task),
		Questions: make([]*pb.MockTaskQuestion, 0, len(tw.Questions)),
	}
	for _, q := range tw.Questions {
		out.Questions = append(out.Questions, mockTaskQuestionToProto(q))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) AdminCreateTask(
	ctx context.Context,
	req *connect.Request[pb.AdminCreateMockTaskRequest],
) (*connect.Response[pb.MockTask], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	in := req.Msg.GetTask()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task is required"))
	}
	t, terr := mockTaskFromProtoInput(in, uuid.Nil)
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	out, err := s.H.CreateTask(ctx, t)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(mockTaskToProto(out)), nil
}

func (s *Server) AdminUpdateTask(
	ctx context.Context,
	req *connect.Request[pb.AdminUpdateMockTaskRequest],
) (*connect.Response[pb.MockTask], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	in := req.Msg.GetTask()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task is required"))
	}
	t, terr := mockTaskFromProtoInput(in, id)
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	out, err := s.H.UpdateTask(ctx, t)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(mockTaskToProto(out)), nil
}

func (s *Server) AdminToggleTaskActive(
	ctx context.Context,
	req *connect.Request[pb.AdminToggleMockTaskActiveRequest],
) (*connect.Response[emptypb.Empty], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.H.SetTaskActive(ctx, id, req.Msg.GetActive()); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ── task mappers ────────────────────────────────────────────────────────

func mockTaskToProto(t domain.MockTask) *pb.MockTask {
	out := &pb.MockTask{
		Id:                       t.ID.String(),
		StageKind:                string(t.StageKind),
		Language:                 string(t.Language),
		Difficulty:               int32(t.Difficulty),
		Title:                    t.Title,
		BodyMd:                   t.BodyMD,
		SampleIoMd:               t.SampleIOMD,
		ReferenceCriteria:        referenceCriteriaToProto(t.ReferenceCriteria),
		ReferenceSolutionMd:      t.ReferenceSolutionMD,
		FunctionalRequirementsMd: t.FunctionalRequirementsMD,
		TimeLimitMin:             int32(t.TimeLimitMin),
		LlmModel:                 t.LLMModel,
		Active:                   t.Active,
	}
	if t.AIStrictnessProfileID != nil {
		out.AiStrictnessProfileId = t.AIStrictnessProfileID.String()
	}
	if !t.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(t.CreatedAt.UTC())
	}
	if !t.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(t.UpdatedAt.UTC())
	}
	return out
}

func mockTaskQuestionToProto(q domain.TaskQuestion) *pb.MockTaskQuestion {
	out := &pb.MockTaskQuestion{
		Id:                q.ID.String(),
		TaskId:            q.TaskID.String(),
		Body:              q.Body,
		ExpectedAnswerMd:  q.ExpectedAnswerMD,
		ReferenceCriteria: referenceCriteriaToProto(q.ReferenceCriteria),
		SortOrder:         int32(q.SortOrder),
	}
	if !q.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(q.CreatedAt.UTC())
	}
	return out
}

func mockTaskFromProtoInput(in *pb.MockTaskInput, id uuid.UUID) (domain.MockTask, error) {
	rc := domain.ReferenceCriteria{}
	if in.GetReferenceCriteria() != nil {
		rc = domain.ReferenceCriteria{
			MustMention:    in.GetReferenceCriteria().GetMustMention(),
			NiceToHave:     in.GetReferenceCriteria().GetNiceToHave(),
			CommonPitfalls: in.GetReferenceCriteria().GetCommonPitfalls(),
		}
	}
	t := domain.MockTask{
		ID:                       id,
		StageKind:                domain.StageKind(in.GetStageKind()),
		Language:                 domain.TaskLanguage(in.GetLanguage()),
		Difficulty:               int(in.GetDifficulty()),
		Title:                    in.GetTitle(),
		BodyMD:                   in.GetBodyMd(),
		SampleIOMD:               in.GetSampleIoMd(),
		ReferenceCriteria:        rc,
		ReferenceSolutionMD:      in.GetReferenceSolutionMd(),
		FunctionalRequirementsMD: in.GetFunctionalRequirementsMd(),
		TimeLimitMin:             int(in.GetTimeLimitMin()),
		LLMModel:                 in.GetLlmModel(),
		Active:                   in.GetActive(),
	}
	if v := in.GetAiStrictnessProfileId(); v != "" {
		pid, err := uuid.Parse(v)
		if err != nil {
			return domain.MockTask{}, errors.New("invalid ai_strictness_profile_id")
		}
		t.AIStrictnessProfileID = &pid
	}
	return t, nil
}

// ── admin: task questions ──────────────────────────────────────────────

func (s *Server) AdminCreateTaskQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminCreateMockTaskQuestionRequest],
) (*connect.Response[pb.MockTaskQuestion], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	taskID, perr := uuid.Parse(req.Msg.GetTaskId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid task_id"))
	}
	in := req.Msg.GetQuestion()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("question is required"))
	}
	q := domain.TaskQuestion{
		TaskID:            taskID,
		Body:              in.GetBody(),
		ExpectedAnswerMD:  in.GetExpectedAnswerMd(),
		ReferenceCriteria: refCriteriaFromProto(in.GetReferenceCriteria()),
		SortOrder:         int(in.GetSortOrder()),
	}
	out, err := s.H.CreateTaskQuestion(ctx, q)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(mockTaskQuestionToProto(out)), nil
}

func (s *Server) AdminUpdateTaskQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminUpdateMockTaskQuestionRequest],
) (*connect.Response[pb.MockTaskQuestion], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	in := req.Msg.GetQuestion()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("question is required"))
	}
	q := domain.TaskQuestion{
		ID:                id,
		Body:              in.GetBody(),
		ExpectedAnswerMD:  in.GetExpectedAnswerMd(),
		ReferenceCriteria: refCriteriaFromProto(in.GetReferenceCriteria()),
		SortOrder:         int(in.GetSortOrder()),
	}
	out, err := s.H.UpdateTaskQuestion(ctx, q)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(mockTaskQuestionToProto(out)), nil
}

func (s *Server) AdminDeleteTaskQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminDeleteMockTaskQuestionRequest],
) (*connect.Response[emptypb.Empty], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.H.DeleteTaskQuestion(ctx, id); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ── admin: test cases ──────────────────────────────────────────────────

func (s *Server) AdminListTestCases(
	ctx context.Context,
	req *connect.Request[pb.AdminListTestCasesRequest],
) (*connect.Response[pb.AdminListTestCasesResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	taskID, perr := uuid.Parse(req.Msg.GetTaskId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid task_id"))
	}
	out, err := s.H.ListTestCases(ctx, taskID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.AdminListTestCasesResponse{Items: make([]*pb.MockTaskTestCase, 0, len(out))}
	for _, tc := range out {
		resp.Items = append(resp.Items, testCaseToProto(tc))
	}
	return connect.NewResponse(resp), nil
}

func (s *Server) AdminCreateTestCase(
	ctx context.Context,
	req *connect.Request[pb.AdminCreateTestCaseRequest],
) (*connect.Response[pb.MockTaskTestCase], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	taskID, perr := uuid.Parse(req.Msg.GetTaskId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid task_id"))
	}
	in := req.Msg.GetTestCase()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("test_case is required"))
	}
	out, err := s.H.CreateTestCase(ctx, domain.MockTaskTestCase{
		TaskID:   taskID,
		Input:    in.GetInput(),
		Expected: in.GetExpectedOutput(),
		IsHidden: in.GetIsHidden(),
		Ordinal:  int(in.GetOrdinal()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(testCaseToProto(out)), nil
}

func (s *Server) AdminUpdateTestCase(
	ctx context.Context,
	req *connect.Request[pb.AdminUpdateTestCaseRequest],
) (*connect.Response[pb.MockTaskTestCase], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	in := req.Msg.GetTestCase()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("test_case is required"))
	}
	out, err := s.H.UpdateTestCase(ctx, domain.MockTaskTestCase{
		ID:       id,
		Input:    in.GetInput(),
		Expected: in.GetExpectedOutput(),
		IsHidden: in.GetIsHidden(),
		Ordinal:  int(in.GetOrdinal()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(testCaseToProto(out)), nil
}

func (s *Server) AdminDeleteTestCase(
	ctx context.Context,
	req *connect.Request[pb.AdminDeleteTestCaseRequest],
) (*connect.Response[emptypb.Empty], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.H.DeleteTestCase(ctx, id); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ── shared mappers ─────────────────────────────────────────────────────

// refCriteriaFromProto — общий маппер для task-input типов.
func refCriteriaFromProto(rc *pb.ReferenceCriteria) domain.ReferenceCriteria {
	if rc == nil {
		return domain.ReferenceCriteria{}
	}
	return domain.ReferenceCriteria{
		MustMention:    rc.GetMustMention(),
		NiceToHave:     rc.GetNiceToHave(),
		CommonPitfalls: rc.GetCommonPitfalls(),
	}
}

func testCaseToProto(tc domain.MockTaskTestCase) *pb.MockTaskTestCase {
	return &pb.MockTaskTestCase{
		Id:             tc.ID.String(),
		TaskId:         tc.TaskID.String(),
		Input:          tc.Input,
		ExpectedOutput: tc.Expected,
		IsHidden:       tc.IsHidden,
		Ordinal:        int32(tc.Ordinal),
	}
}

// ── admin: default questions ───────────────────────────────────────────

func (s *Server) AdminListDefaultQuestions(
	ctx context.Context,
	req *connect.Request[pb.AdminListDefaultQuestionsRequest],
) (*connect.Response[pb.AdminListDefaultQuestionsResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	out, err := s.H.ListDefaultQuestions(ctx, domain.StageKind(req.Msg.GetStageKind()), req.Msg.GetOnlyActive())
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.AdminListDefaultQuestionsResponse{Items: make([]*pb.MockDefaultQuestion, 0, len(out))}
	for _, q := range out {
		resp.Items = append(resp.Items, defaultQuestionToProto(q))
	}
	return connect.NewResponse(resp), nil
}

func (s *Server) AdminCreateDefaultQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminCreateDefaultQuestionRequest],
) (*connect.Response[pb.MockDefaultQuestion], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	in := req.Msg.GetQuestion()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("question is required"))
	}
	out, err := s.H.CreateDefaultQuestion(ctx, defaultQuestionFromProto(in, uuid.Nil))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(defaultQuestionToProto(out)), nil
}

func (s *Server) AdminUpdateDefaultQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminUpdateDefaultQuestionRequest],
) (*connect.Response[pb.MockDefaultQuestion], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	in := req.Msg.GetQuestion()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("question is required"))
	}
	out, err := s.H.UpdateDefaultQuestion(ctx, defaultQuestionFromProto(in, id))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(defaultQuestionToProto(out)), nil
}

func (s *Server) AdminDeleteDefaultQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminDeleteDefaultQuestionRequest],
) (*connect.Response[emptypb.Empty], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.H.DeleteDefaultQuestion(ctx, id); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ── admin: company questions ──────────────────────────────────────────

func (s *Server) AdminListCompanyQuestions(
	ctx context.Context,
	req *connect.Request[pb.AdminListCompanyQuestionsRequest],
) (*connect.Response[pb.AdminListCompanyQuestionsResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	companyID, perr := uuid.Parse(req.Msg.GetCompanyId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid company_id"))
	}
	out, err := s.H.ListCompanyQuestions(ctx, companyID, domain.StageKind(req.Msg.GetStageKind()))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.AdminListCompanyQuestionsResponse{Items: make([]*pb.MockCompanyQuestion, 0, len(out))}
	for _, q := range out {
		resp.Items = append(resp.Items, companyQuestionToProto(q))
	}
	return connect.NewResponse(resp), nil
}

func (s *Server) AdminCreateCompanyQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminCreateCompanyQuestionRequest],
) (*connect.Response[pb.MockCompanyQuestion], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	companyID, perr := uuid.Parse(req.Msg.GetCompanyId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid company_id"))
	}
	in := req.Msg.GetQuestion()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("question is required"))
	}
	q := companyQuestionFromProto(in, uuid.Nil)
	q.CompanyID = companyID
	out, err := s.H.CreateCompanyQuestion(ctx, q)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(companyQuestionToProto(out)), nil
}

func (s *Server) AdminUpdateCompanyQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminUpdateCompanyQuestionRequest],
) (*connect.Response[pb.MockCompanyQuestion], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	in := req.Msg.GetQuestion()
	if in == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("question is required"))
	}
	out, err := s.H.UpdateCompanyQuestion(ctx, companyQuestionFromProto(in, id))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(companyQuestionToProto(out)), nil
}

func (s *Server) AdminDeleteCompanyQuestion(
	ctx context.Context,
	req *connect.Request[pb.AdminDeleteCompanyQuestionRequest],
) (*connect.Response[emptypb.Empty], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.H.DeleteCompanyQuestion(ctx, id); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ── default/company question mappers ──────────────────────────────────

func defaultQuestionToProto(q domain.DefaultQuestion) *pb.MockDefaultQuestion {
	out := &pb.MockDefaultQuestion{
		Id:                q.ID.String(),
		StageKind:         string(q.StageKind),
		Body:              q.Body,
		ExpectedAnswerMd:  q.ExpectedAnswerMD,
		ReferenceCriteria: referenceCriteriaToProto(q.ReferenceCriteria),
		Active:            q.Active,
		SortOrder:         int32(q.SortOrder),
	}
	if !q.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(q.CreatedAt.UTC())
	}
	return out
}

func defaultQuestionFromProto(in *pb.MockDefaultQuestionInput, id uuid.UUID) domain.DefaultQuestion {
	return domain.DefaultQuestion{
		ID:                id,
		StageKind:         domain.StageKind(in.GetStageKind()),
		Body:              in.GetBody(),
		ExpectedAnswerMD:  in.GetExpectedAnswerMd(),
		ReferenceCriteria: refCriteriaFromProto(in.GetReferenceCriteria()),
		Active:            in.GetActive(),
		SortOrder:         int(in.GetSortOrder()),
	}
}

func companyQuestionToProto(q domain.CompanyQuestion) *pb.MockCompanyQuestion {
	out := &pb.MockCompanyQuestion{
		Id:                q.ID.String(),
		CompanyId:         q.CompanyID.String(),
		StageKind:         string(q.StageKind),
		Body:              q.Body,
		ExpectedAnswerMd:  q.ExpectedAnswerMD,
		ReferenceCriteria: referenceCriteriaToProto(q.ReferenceCriteria),
		Active:            q.Active,
		SortOrder:         int32(q.SortOrder),
	}
	if !q.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(q.CreatedAt.UTC())
	}
	return out
}

func companyQuestionFromProto(in *pb.MockCompanyQuestionInput, id uuid.UUID) domain.CompanyQuestion {
	return domain.CompanyQuestion{
		ID:                id,
		StageKind:         domain.StageKind(in.GetStageKind()),
		Body:              in.GetBody(),
		ExpectedAnswerMD:  in.GetExpectedAnswerMd(),
		ReferenceCriteria: refCriteriaFromProto(in.GetReferenceCriteria()),
		Active:            in.GetActive(),
		SortOrder:         int(in.GetSortOrder()),
	}
}

// ── admin: company stages ─────────────────────────────────────────────

func (s *Server) AdminGetCompanyStages(
	ctx context.Context,
	req *connect.Request[pb.AdminGetCompanyStagesRequest],
) (*connect.Response[pb.AdminGetCompanyStagesResponse], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	companyID, perr := uuid.Parse(req.Msg.GetCompanyId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid company_id"))
	}
	stages, err := s.H.GetCompanyStages(ctx, companyID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.AdminGetCompanyStagesResponse{Items: make([]*pb.MockCompanyStage, 0, len(stages))}
	for _, st := range stages {
		resp.Items = append(resp.Items, companyStageToProto(st))
	}
	return connect.NewResponse(resp), nil
}

func (s *Server) AdminReplaceCompanyStages(
	ctx context.Context,
	req *connect.Request[pb.AdminReplaceCompanyStagesRequest],
) (*connect.Response[emptypb.Empty], error) {
	if _, err := s.requireAdminConnect(ctx); err != nil {
		return nil, err
	}
	companyID, perr := uuid.Parse(req.Msg.GetCompanyId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid company_id"))
	}
	stages := make([]domain.CompanyStage, 0, len(req.Msg.GetItems()))
	for _, item := range req.Msg.GetItems() {
		st, err := companyStageFromProto(companyID, item)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		stages = append(stages, st)
	}
	if err := s.H.ReplaceCompanyStages(ctx, companyID, stages); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ── admin: bulk task import ───────────────────────────────────────────

func (s *Server) AdminBulkImportTasks(
	ctx context.Context,
	req *connect.Request[pb.AdminBulkImportTasksRequest],
) (*connect.Response[pb.AdminBulkImportTasksResponse], error) {
	uid, err := s.requireAdminConnect(ctx)
	if err != nil {
		return nil, err
	}
	tasks := req.Msg.GetTasks()
	if len(tasks) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tasks: empty"))
	}
	if len(tasks) > 200 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("tasks: max 200 per batch"))
	}
	in := app.BulkTaskImport{Tasks: make([]app.BulkTaskImportItem, 0, len(tasks))}
	for _, t := range tasks {
		in.Tasks = append(in.Tasks, bulkImportItemFromProto(t))
	}
	results, err := s.H.BulkImportTasks(ctx, in, &uid)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.AdminBulkImportTasksResponse{Results: make([]*pb.MockBulkImportResult, 0, len(results))}
	for _, r := range results {
		resp.Results = append(resp.Results, &pb.MockBulkImportResult{
			Index:          int32(r.Index),
			TaskId:         r.TaskID,
			TestCasesAdded: int32(r.TestCasesAdded),
			Error:          r.Error,
		})
	}
	return connect.NewResponse(resp), nil
}

// ── stage / bulk-import mappers ──────────────────────────────────────

func companyStageToProto(s domain.CompanyStage) *pb.MockCompanyStage {
	langs := make([]string, 0, len(s.LanguagePool))
	for _, l := range s.LanguagePool {
		langs = append(langs, string(l))
	}
	taskIDs := make([]string, 0, len(s.TaskPoolIDs))
	for _, t := range s.TaskPoolIDs {
		taskIDs = append(taskIDs, t.String())
	}
	out := &pb.MockCompanyStage{
		StageKind:    string(s.StageKind),
		Ordinal:      int32(s.Ordinal),
		Optional:     s.Optional,
		LanguagePool: langs,
		TaskPoolIds:  taskIDs,
	}
	if s.AIStrictnessProfileID != nil {
		out.AiStrictnessProfileId = s.AIStrictnessProfileID.String()
	}
	if s.DefaultQuestionLimit != nil {
		out.HasDefaultQuestionLimit = true
		out.DefaultQuestionLimit = int32(*s.DefaultQuestionLimit)
	}
	if s.CompanyQuestionLimit != nil {
		out.HasCompanyQuestionLimit = true
		out.CompanyQuestionLimit = int32(*s.CompanyQuestionLimit)
	}
	return out
}

func companyStageFromProto(companyID uuid.UUID, in *pb.MockCompanyStage) (domain.CompanyStage, error) {
	out := domain.CompanyStage{
		CompanyID: companyID,
		StageKind: domain.StageKind(in.GetStageKind()),
		Ordinal:   int(in.GetOrdinal()),
		Optional:  in.GetOptional(),
	}
	for _, l := range in.GetLanguagePool() {
		out.LanguagePool = append(out.LanguagePool, domain.TaskLanguage(l))
	}
	for _, t := range in.GetTaskPoolIds() {
		id, err := uuid.Parse(t)
		if err != nil {
			return domain.CompanyStage{}, errors.New("invalid task_pool_id")
		}
		out.TaskPoolIDs = append(out.TaskPoolIDs, id)
	}
	if v := in.GetAiStrictnessProfileId(); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			return domain.CompanyStage{}, errors.New("invalid ai_strictness_profile_id")
		}
		out.AIStrictnessProfileID = &id
	}
	if in.GetHasDefaultQuestionLimit() {
		v := int(in.GetDefaultQuestionLimit())
		out.DefaultQuestionLimit = &v
	}
	if in.GetHasCompanyQuestionLimit() {
		v := int(in.GetCompanyQuestionLimit())
		out.CompanyQuestionLimit = &v
	}
	return out, nil
}

func bulkImportItemFromProto(t *pb.MockBulkTaskImportItem) app.BulkTaskImportItem {
	tc := make([]app.BulkTestCase, 0, len(t.GetTestCases()))
	for _, c := range t.GetTestCases() {
		tc = append(tc, app.BulkTestCase{
			Input:    c.GetInput(),
			Expected: c.GetExpectedOutput(),
			IsHidden: c.GetIsHidden(),
			Ordinal:  int(c.GetOrdinal()),
		})
	}
	return app.BulkTaskImportItem{
		StageKind:                domain.StageKind(t.GetStageKind()),
		Language:                 domain.TaskLanguage(t.GetLanguage()),
		Difficulty:               int(t.GetDifficulty()),
		Title:                    t.GetTitle(),
		BodyMD:                   t.GetBodyMd(),
		SampleIOMD:               t.GetSampleIoMd(),
		ReferenceCriteria:        refCriteriaFromProto(t.GetReferenceCriteria()),
		ReferenceSolutionMD:      t.GetReferenceSolutionMd(),
		FunctionalRequirementsMD: t.GetFunctionalRequirementsMd(),
		TimeLimitMin:             int(t.GetTimeLimitMin()),
		LLMModel:                 t.GetLlmModel(),
		Active:                   t.GetActive(),
		TestCases:                tc,
	}
}
