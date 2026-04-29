// admin_tasks.go — Connect-RPC adapter for the admin Arena task CMS.
//
// Auth gate (admin role) is applied above the transcoder by the cmd-side
// wirer; this file just translates proto ↔ domain.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"druz9/arena/app"
	"druz9/arena/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
)

type AdminTaskServer struct {
	ListUC   *app.ListAdminTasks
	GetUC    *app.GetAdminTask
	CreateUC *app.CreateAdminTask
	UpdateUC *app.UpdateAdminTask
	ToggleUC *app.ToggleAdminTaskActive
	DeleteUC *app.DeleteAdminTask
	Log      *slog.Logger
}

var _ druz9v1connect.ArenaAdminTaskServiceHandler = (*AdminTaskServer)(nil)

func (s *AdminTaskServer) ListAdminTasks(
	ctx context.Context,
	req *connect.Request[pb.ListArenaAdminTasksRequest],
) (*connect.Response[pb.ArenaAdminTaskList], error) {
	limit := int(req.Msg.Limit)
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.ListUC.Run(ctx, domain.AdminTaskListFilter{
		Section:    req.Msg.Section,
		Difficulty: req.Msg.Difficulty,
		OnlyActive: req.Msg.OnlyActive,
		Limit:      limit,
	})
	if err != nil {
		if errors.Is(err, domain.ErrAdminTaskInvalid) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.logErr(ctx, "ListAdminTasks", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.ArenaAdminTaskList{Items: make([]*pb.ArenaAdminTask, 0, len(rows))}
	for _, t := range rows {
		out.Items = append(out.Items, adminTaskToProto(t))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminTaskServer) GetAdminTask(
	ctx context.Context,
	req *connect.Request[pb.GetArenaAdminTaskRequest],
) (*connect.Response[pb.ArenaAdminTask], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	t, err := s.GetUC.Run(ctx, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "GetAdminTask", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(adminTaskToProto(t)), nil
}

func (s *AdminTaskServer) CreateAdminTask(
	ctx context.Context,
	req *connect.Request[pb.CreateArenaAdminTaskRequest],
) (*connect.Response[pb.ArenaAdminTask], error) {
	if req.Msg.Task == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task required"))
	}
	t, err := s.CreateUC.Run(ctx, adminTaskUpsertFromProto(req.Msg.Task))
	if err != nil {
		if errors.Is(err, domain.ErrAdminTaskInvalid) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.logErr(ctx, "CreateAdminTask", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(adminTaskToProto(t)), nil
}

func (s *AdminTaskServer) UpdateAdminTask(
	ctx context.Context,
	req *connect.Request[pb.UpdateArenaAdminTaskRequest],
) (*connect.Response[pb.ArenaAdminTask], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if req.Msg.Task == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("task required"))
	}
	t, err := s.UpdateUC.Run(ctx, id, adminTaskUpsertFromProto(req.Msg.Task))
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrAdminTaskInvalid):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "UpdateAdminTask", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(adminTaskToProto(t)), nil
}

func (s *AdminTaskServer) ToggleAdminTask(
	ctx context.Context,
	req *connect.Request[pb.ToggleArenaAdminTaskRequest],
) (*connect.Response[pb.ToggleArenaAdminTaskResponse], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.ToggleUC.Run(ctx, id, req.Msg.Active); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "ToggleAdminTask", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.ToggleArenaAdminTaskResponse{Ok: true}), nil
}

func (s *AdminTaskServer) DeleteAdminTask(
	ctx context.Context,
	req *connect.Request[pb.DeleteArenaAdminTaskRequest],
) (*connect.Response[pb.DeleteArenaAdminTaskResponse], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.DeleteUC.Run(ctx, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		// FK violation when match_history references — surface as 409.
		s.logErr(ctx, "DeleteAdminTask", err)
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("cannot delete (referenced by match history)"))
	}
	return connect.NewResponse(&pb.DeleteArenaAdminTaskResponse{Ok: true}), nil
}

func (s *AdminTaskServer) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "arena.admin."+where, slog.Any("err", err))
}

func adminTaskToProto(t domain.AdminTask) *pb.ArenaAdminTask {
	return &pb.ArenaAdminTask{
		Id: t.ID.String(), Slug: t.Slug,
		TitleRu: t.TitleRU, TitleEn: t.TitleEN,
		DescriptionRu: t.DescriptionRU, DescriptionEn: t.DescriptionEN,
		Difficulty: t.Difficulty, Section: t.Section,
		TimeLimitSec:  int32(t.TimeLimitSec),
		MemoryLimitMb: int32(t.MemoryLimitMB),
		SolutionHint:  t.SolutionHint,
		Version:       int32(t.Version),
		IsActive:      t.IsActive,
		AvgRating:     t.AvgRating,
	}
}

func adminTaskUpsertFromProto(p *pb.ArenaAdminTaskUpsert) domain.AdminTaskUpsert {
	return domain.AdminTaskUpsert{
		Slug:          p.Slug,
		TitleRU:       p.TitleRu,
		TitleEN:       p.TitleEn,
		DescriptionRU: p.DescriptionRu,
		DescriptionEN: p.DescriptionEn,
		Difficulty:    p.Difficulty,
		Section:       p.Section,
		TimeLimitSec:  int(p.TimeLimitSec),
		MemoryLimitMB: int(p.MemoryLimitMb),
		SolutionHint:  p.SolutionHint,
		IsActive:      p.IsActive,
	}
}
