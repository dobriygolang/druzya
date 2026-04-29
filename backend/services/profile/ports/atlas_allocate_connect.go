// atlas_allocate_connect.go — Connect-RPC adapter for the atlas/allocate +
// ai-vacancies-model endpoints. The chi handlers (atlas_allocate_handler.go,
// ai_vacancies_model_handler.go) are kept for tests but no longer mounted
// by the wirer.
package ports

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"

	"druz9/profile/app"
	"druz9/profile/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

func (s *ProfileServer) AllocateAtlasSkill(
	ctx context.Context,
	req *connect.Request[pb.AllocateAtlasSkillRequest],
) (*connect.Response[pb.AllocateAtlasSkillResponse], error) {
	if s.H.AllocateAtlas == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.H.AllocateAtlas.Do(ctx, uid, strings.TrimSpace(req.Msg.SkillId))
	if err != nil {
		switch {
		case errors.Is(err, app.ErrInvalid):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound,
				errors.New("skill_id not found in atlas catalogue"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	resp := &pb.AllocateAtlasSkillResponse{
		Key:      out.NodeKey,
		Progress: int32(out.Progress),
		Unlocked: out.UnlockedAt != nil,
	}
	if out.UnlockedAt != nil {
		resp.UnlockedAt = out.UnlockedAt.UTC().Format(time.RFC3339)
	}
	if !out.UpdatedAt.IsZero() {
		resp.UpdatedAt = out.UpdatedAt.UTC().Format(time.RFC3339)
	}
	return connect.NewResponse(resp), nil
}

func (s *ProfileServer) GetAIVacanciesModel(
	ctx context.Context,
	_ *connect.Request[pb.GetAIVacanciesModelRequest],
) (*connect.Response[pb.AIVacanciesModel], error) {
	if s.H.VacanciesModel == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := s.H.VacanciesModel.GetVacanciesModel(ctx, uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("user not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.AIVacanciesModel{ModelId: id}), nil
}

func (s *ProfileServer) SetAIVacanciesModel(
	ctx context.Context,
	req *connect.Request[pb.SetAIVacanciesModelRequest],
) (*connect.Response[pb.AIVacanciesModel], error) {
	if s.H.VacanciesModel == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if err := s.H.VacanciesModel.SetVacanciesModel(ctx, uid, req.Msg.ModelId); err != nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.AIVacanciesModel{ModelId: req.Msg.ModelId}), nil
}
