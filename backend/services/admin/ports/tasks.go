package ports

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListTasks(
	ctx context.Context,
	req *connect.Request[pb.ListAdminTasksRequest],
) (*connect.Response[pb.AdminTaskList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	m := req.Msg
	f := domain.TaskFilter{
		Page:  int(m.GetPage()),
		Limit: int(m.GetLimit()),
	}
	if pbSec := m.GetSection(); pbSec != pb.Section_SECTION_UNSPECIFIED {
		sec := sectionFromProtoAdmin(pbSec)
		f.Section = &sec
	}
	if pbDiff := m.GetDifficulty(); pbDiff != pb.Difficulty_DIFFICULTY_UNSPECIFIED {
		d := difficultyFromProtoAdmin(pbDiff)
		f.Difficulty = &d
	}
	if m.GetIsActiveSet() {
		v := m.GetIsActive()
		f.IsActive = &v
	}
	page, err := s.ListTasksUC.Do(ctx, f)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminTaskList{
		Total: int32(page.Total),
		Page:  int32(page.Page),
		Items: make([]*pb.AdminTask, 0, len(page.Items)),
	}
	for _, t := range page.Items {
		out.Items = append(out.Items, toAdminTaskProto(t))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminServer) CreateTask(
	ctx context.Context,
	req *connect.Request[pb.CreateAdminTaskRequest],
) (*connect.Response[pb.AdminTask], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	body := req.Msg.GetTask()
	if body == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task body required"))
	}
	out, err := s.CreateTaskUC.Do(ctx, taskUpsertFromProto(body))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toAdminTaskProto(out)), nil
}

func (s *AdminServer) UpdateTask(
	ctx context.Context,
	req *connect.Request[pb.UpdateAdminTaskRequest],
) (*connect.Response[pb.AdminTask], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	taskID, err := uuid.Parse(req.Msg.GetTaskId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid task_id: %w", err))
	}
	body := req.Msg.GetTask()
	if body == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task body required"))
	}
	out, err := s.UpdateTaskUC.Do(ctx, taskID, taskUpsertFromProto(body))
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toAdminTaskProto(out)), nil
}

func toAdminTaskProto(t domain.AdminTask) *pb.AdminTask {
	out := &pb.AdminTask{
		Id:            t.ID.String(),
		Slug:          t.Slug,
		TitleRu:       t.TitleRU,
		TitleEn:       t.TitleEN,
		DescriptionRu: t.DescriptionRU,
		DescriptionEn: t.DescriptionEN,
		Difficulty:    difficultyToProtoAdmin(t.Difficulty),
		Section:       sectionToProtoAdmin(t.Section),
		TimeLimitSec:  int32(t.TimeLimitSec),
		MemoryLimitMb: int32(t.MemoryLimitMB),
		SolutionHint:  t.SolutionHint, // admin-only — see package doc.
		Version:       int32(t.Version),
		IsActive:      t.IsActive,
	}
	for _, c := range t.TestCases {
		out.TestCases = append(out.TestCases, &pb.AdminTaskTestCase{
			Id:             c.ID.String(),
			Input:          c.Input,
			ExpectedOutput: c.ExpectedOutput,
			IsHidden:       c.IsHidden,
			OrderNum:       int32(c.OrderNum),
		})
	}
	for _, q := range t.FollowUpQuestions {
		out.FollowUpQuestions = append(out.FollowUpQuestions, &pb.AdminTaskFollowUpQuestion{
			QuestionRu: q.QuestionRU,
			QuestionEn: q.QuestionEN,
			AnswerHint: q.AnswerHint,
			OrderNum:   int32(q.OrderNum),
		})
	}
	return out
}

func taskUpsertFromProto(in *pb.AdminTaskUpsert) domain.TaskUpsert {
	out := domain.TaskUpsert{
		Slug:          in.GetSlug(),
		TitleRU:       in.GetTitleRu(),
		TitleEN:       in.GetTitleEn(),
		DescriptionRU: in.GetDescriptionRu(),
		DescriptionEN: in.GetDescriptionEn(),
		Difficulty:    difficultyFromProtoAdmin(in.GetDifficulty()),
		Section:       sectionFromProtoAdmin(in.GetSection()),
		TimeLimitSec:  int(in.GetTimeLimitSec()),
		MemoryLimitMB: int(in.GetMemoryLimitMb()),
		SolutionHint:  in.GetSolutionHint(),
		IsActive:      in.GetIsActive(),
	}
	// Preserve the apigen default behaviour — empty limits fall back to
	// 60s / 256 MB. Without this the domain validation would reject the row.
	if out.TimeLimitSec <= 0 {
		out.TimeLimitSec = 60
	}
	if out.MemoryLimitMB <= 0 {
		out.MemoryLimitMB = 256
	}
	for _, c := range in.GetTestCases() {
		out.TestCases = append(out.TestCases, domain.TestCase{
			Input:          c.GetInput(),
			ExpectedOutput: c.GetExpectedOutput(),
			IsHidden:       c.GetIsHidden(),
			OrderNum:       int(c.GetOrderNum()),
		})
	}
	for _, q := range in.GetFollowUpQuestions() {
		out.FollowUpQuestions = append(out.FollowUpQuestions, domain.FollowUpQuestion{
			QuestionRU: q.GetQuestionRu(),
			QuestionEN: q.GetQuestionEn(),
			AnswerHint: q.GetAnswerHint(),
			OrderNum:   int(q.GetOrderNum()),
		})
	}
	return out
}
