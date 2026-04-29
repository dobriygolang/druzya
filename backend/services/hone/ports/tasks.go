// tasks.go — Connect-RPC adapters for the TaskBoard methods.
//
// Wire shape mirrors the original chi handlers in cmd/monolith (now removed)
// so the frontend keeps working unchanged. The vanguard transcoder mounted
// in cmd/monolith/services/hone routes both /api/v1/hone/tasks/* (REST) and
// /druz9.v1.HoneService/* (Connect) into these methods.
package ports

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	"druz9/hone/app"
	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

func (s *HoneServer) ListTasks(
	ctx context.Context,
	_ *connect.Request[pb.ListTasksRequest],
) (*connect.Response[pb.ListTasksResponse], error) {
	uid, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.H.ListTasks.Do(ctx, uid)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.ListTasksResponse{Tasks: make([]*pb.Task, 0, len(rows))}
	for _, t := range rows {
		out.Tasks = append(out.Tasks, taskToProto(t))
	}
	return connect.NewResponse(out), nil
}

func (s *HoneServer) CreateTask(
	ctx context.Context,
	req *connect.Request[pb.CreateTaskRequest],
) (*connect.Response[pb.Task], error) {
	uid, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if req.Msg.Title == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("empty_title"))
	}
	created, err := s.H.CreateTask.Do(ctx, app.CreateTaskInput{
		UserID:   uid,
		Kind:     taskKindFromProto(req.Msg.Kind),
		Title:    req.Msg.Title,
		BriefMD:  req.Msg.BriefMd,
		SkillKey: req.Msg.SkillKey,
		DeepLink: req.Msg.DeepLink,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(taskToProto(created)), nil
}

func (s *HoneServer) MoveTaskStatus(
	ctx context.Context,
	req *connect.Request[pb.MoveTaskStatusRequest],
) (*connect.Response[pb.Task], error) {
	uid, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	updated, err := s.H.MoveTaskStatus.Do(ctx, app.MoveTaskStatusInput{
		UserID: uid, TaskID: id, Status: taskStatusFromProto(req.Msg.Status),
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(taskToProto(updated)), nil
}

func (s *HoneServer) DeleteTask(
	ctx context.Context,
	req *connect.Request[pb.DeleteTaskRequest],
) (*connect.Response[pb.DeleteTaskResponse], error) {
	uid, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	if err := s.H.DeleteTask.Do(ctx, uid, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.DeleteTaskResponse{Ok: true}), nil
}

func (s *HoneServer) ListTaskComments(
	ctx context.Context,
	req *connect.Request[pb.ListTaskCommentsRequest],
) (*connect.Response[pb.ListTaskCommentsResponse], error) {
	uid, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	rows, err := s.H.ListTaskComments.Do(ctx, uid, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.ListTaskCommentsResponse{Comments: make([]*pb.TaskComment, 0, len(rows))}
	for _, c := range rows {
		out.Comments = append(out.Comments, taskCommentToProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *HoneServer) AddTaskComment(
	ctx context.Context,
	req *connect.Request[pb.AddTaskCommentRequest],
) (*connect.Response[pb.TaskComment], error) {
	uid, err := s.requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.Id)
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	c, err := s.H.AddTaskComment.Do(ctx, app.AddTaskCommentInput{
		UserID: uid, TaskID: id, BodyMD: req.Msg.BodyMd,
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(taskCommentToProto(c)), nil
}

// ── helpers ─────────────────────────────────────────────────────────────

func (s *HoneServer) requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

// ── enum mappers (Phase enum-migration) ─────────────────────────────────

func taskStatusToProto(s domain.TaskStatus) pb.TaskStatus {
	switch s {
	case domain.TaskStatusToDo:
		return pb.TaskStatus_TASK_STATUS_TODO
	case domain.TaskStatusInProgress:
		return pb.TaskStatus_TASK_STATUS_IN_PROGRESS
	case domain.TaskStatusInReview:
		return pb.TaskStatus_TASK_STATUS_IN_REVIEW
	case domain.TaskStatusDone:
		return pb.TaskStatus_TASK_STATUS_DONE
	case domain.TaskStatusDismissed:
		return pb.TaskStatus_TASK_STATUS_DISMISSED
	default:
		return pb.TaskStatus_TASK_STATUS_UNSPECIFIED
	}
}

func taskStatusFromProto(s pb.TaskStatus) domain.TaskStatus {
	switch s {
	case pb.TaskStatus_TASK_STATUS_TODO:
		return domain.TaskStatusToDo
	case pb.TaskStatus_TASK_STATUS_IN_PROGRESS:
		return domain.TaskStatusInProgress
	case pb.TaskStatus_TASK_STATUS_IN_REVIEW:
		return domain.TaskStatusInReview
	case pb.TaskStatus_TASK_STATUS_DONE:
		return domain.TaskStatusDone
	case pb.TaskStatus_TASK_STATUS_DISMISSED:
		return domain.TaskStatusDismissed
	default:
		return ""
	}
}

func taskKindToProto(k domain.TaskKind) pb.TaskKind {
	switch k {
	case domain.TaskKindAlgo:
		return pb.TaskKind_TASK_KIND_ALGO
	case domain.TaskKindSysDesign:
		return pb.TaskKind_TASK_KIND_SYSDESIGN
	case domain.TaskKindQuiz:
		return pb.TaskKind_TASK_KIND_QUIZ
	case domain.TaskKindReflection:
		return pb.TaskKind_TASK_KIND_REFLECTION
	case domain.TaskKindReading:
		return pb.TaskKind_TASK_KIND_READING
	case domain.TaskKindCustom:
		return pb.TaskKind_TASK_KIND_CUSTOM
	default:
		return pb.TaskKind_TASK_KIND_UNSPECIFIED
	}
}

func taskKindFromProto(k pb.TaskKind) domain.TaskKind {
	switch k {
	case pb.TaskKind_TASK_KIND_ALGO:
		return domain.TaskKindAlgo
	case pb.TaskKind_TASK_KIND_SYSDESIGN:
		return domain.TaskKindSysDesign
	case pb.TaskKind_TASK_KIND_QUIZ:
		return domain.TaskKindQuiz
	case pb.TaskKind_TASK_KIND_REFLECTION:
		return domain.TaskKindReflection
	case pb.TaskKind_TASK_KIND_READING:
		return domain.TaskKindReading
	case pb.TaskKind_TASK_KIND_CUSTOM:
		return domain.TaskKindCustom
	default:
		return ""
	}
}

func taskSourceToProto(s domain.TaskSource) pb.TaskSource {
	switch s {
	case domain.TaskSourceAI:
		return pb.TaskSource_TASK_SOURCE_AI
	case domain.TaskSourceUser:
		return pb.TaskSource_TASK_SOURCE_USER
	default:
		return pb.TaskSource_TASK_SOURCE_UNSPECIFIED
	}
}

func taskCommentAuthorToProto(a domain.TaskCommentAuthor) pb.TaskCommentAuthor {
	switch a {
	case domain.TaskCommentAuthorAI:
		return pb.TaskCommentAuthor_TASK_COMMENT_AUTHOR_AI
	case domain.TaskCommentAuthorUser:
		return pb.TaskCommentAuthor_TASK_COMMENT_AUTHOR_USER
	default:
		return pb.TaskCommentAuthor_TASK_COMMENT_AUTHOR_UNSPECIFIED
	}
}

func taskToProto(t domain.Task) *pb.Task {
	out := &pb.Task{
		Id:                 t.ID.String(),
		Status:             taskStatusToProto(t.Status),
		Kind:               taskKindToProto(t.Kind),
		Source:             taskSourceToProto(t.Source),
		Title:              t.Title,
		BriefMd:            t.BriefMD,
		SkillKey:           t.SkillKey,
		DeepLink:           t.DeepLink,
		RecommendedReading: t.RecommendedReading,
		Priority:           int32(t.Priority),
		CreatedAt:          timestamppb.New(t.CreatedAt.UTC()),
		UpdatedAt:          timestamppb.New(t.UpdatedAt.UTC()),
	}
	if t.CompletedAt != nil {
		out.CompletedAt = timestamppb.New(t.CompletedAt.UTC())
	}
	return out
}

func taskCommentToProto(c domain.TaskComment) *pb.TaskComment {
	return &pb.TaskComment{
		Id:         c.ID.String(),
		AuthorKind: taskCommentAuthorToProto(c.AuthorKind),
		BodyMd:     c.BodyMD,
		CreatedAt:  timestamppb.New(c.CreatedAt.UTC()),
	}
}
