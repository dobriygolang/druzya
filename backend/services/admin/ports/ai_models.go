// ai_models.go — Connect-RPC adapter for the LLM model catalogue.
//
// model_id includes provider prefixes (e.g. `mistralai/mistral-7b`); the
// proto annotation uses `{model_id=**}` so vanguard captures the full
// slash-containing path segment into the field.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"

	"druz9/admin/app"
	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
)

type AIModelServer struct {
	ListPublicUC *app.ListPublicAIModels
	ListUC       *app.ListAIModels
	CreateUC     *app.CreateAIModel
	UpdateUC     *app.UpdateAIModel
	ToggleUC     *app.ToggleAIModel
	DeleteUC     *app.DeleteAIModel
	Log          *slog.Logger
}

var _ druz9v1connect.AIModelServiceHandler = (*AIModelServer)(nil)

func (s *AIModelServer) ListPublicAIModels(
	ctx context.Context,
	req *connect.Request[pb.ListPublicAIModelsRequest],
) (*connect.Response[pb.PublicAIModelList], error) {
	rows, err := s.ListPublicUC.Do(ctx, domain.PublicAIModelFilter{Surface: req.Msg.Use})
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid use"))
		}
		s.logErr(ctx, "ListPublicAIModels", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.PublicAIModelList{
		Available: len(rows) > 0,
		Items:     make([]*pb.PublicAIModel, 0, len(rows)),
	}
	for _, m := range rows {
		out.Items = append(out.Items, &pb.PublicAIModel{
			Id: m.ID, Label: m.Label, Provider: m.Provider, Tier: m.Tier,
			Available: m.Available, IsVirtual: m.IsVirtual,
		})
	}
	return connect.NewResponse(out), nil
}

func (s *AIModelServer) ListAIModels(
	ctx context.Context,
	_ *connect.Request[pb.ListAdminAIModelsRequest],
) (*connect.Response[pb.AIModelList], error) {
	rows, err := s.ListUC.Do(ctx)
	if err != nil {
		s.logErr(ctx, "ListAIModels", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.AIModelList{Items: make([]*pb.AIModel, 0, len(rows))}
	for _, m := range rows {
		out.Items = append(out.Items, aiModelToProto(m))
	}
	return connect.NewResponse(out), nil
}

func (s *AIModelServer) CreateAIModel(
	ctx context.Context,
	req *connect.Request[pb.CreateAIModelRequest],
) (*connect.Response[pb.AIModel], error) {
	if req.Msg.Model == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("model required"))
	}
	out, err := s.CreateUC.Do(ctx, aiModelUpsertFromProto(req.Msg.Model))
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.logErr(ctx, "CreateAIModel", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(aiModelToProto(out)), nil
}

func (s *AIModelServer) UpdateAIModel(
	ctx context.Context,
	req *connect.Request[pb.UpdateAIModelRequest],
) (*connect.Response[pb.AIModel], error) {
	if req.Msg.ModelId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("model_id required"))
	}
	if req.Msg.Model == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("model required"))
	}
	out, err := s.UpdateUC.Do(ctx, req.Msg.ModelId, aiModelUpsertFromProto(req.Msg.Model))
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidInput):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "UpdateAIModel", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(aiModelToProto(out)), nil
}

func (s *AIModelServer) ToggleAIModel(
	ctx context.Context,
	req *connect.Request[pb.ToggleAIModelRequest],
) (*connect.Response[pb.AIModel], error) {
	if req.Msg.ModelId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("model_id required"))
	}
	out, err := s.ToggleUC.Do(ctx, req.Msg.ModelId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "ToggleAIModel", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(aiModelToProto(out)), nil
}

func (s *AIModelServer) DeleteAIModel(
	ctx context.Context,
	req *connect.Request[pb.DeleteAIModelRequest],
) (*connect.Response[pb.DeleteAIModelResponse], error) {
	if req.Msg.ModelId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("model_id required"))
	}
	if err := s.DeleteUC.Do(ctx, req.Msg.ModelId); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "DeleteAIModel", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.DeleteAIModelResponse{Ok: true}), nil
}

func (s *AIModelServer) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "ai_models."+where, slog.Any("err", err))
}

func aiModelToProto(m domain.AIModel) *pb.AIModel {
	out := &pb.AIModel{
		Id: m.ID, ModelId: m.ModelID, Label: m.Label, Provider: m.Provider,
		Tier:          m.Tier, IsEnabled: m.IsEnabled,
		UseForInsight: m.UseForInsight, UseForMock: m.UseForMock,
		SortOrder: int32(m.SortOrder),
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
	if m.ContextWindow != nil {
		out.ContextWindow = int32(*m.ContextWindow)
		out.HasContextWindow = true
	}
	if m.CostPerKInputUSD != nil {
		out.CostPer_1KInputUsd = *m.CostPerKInputUSD
		out.HasCostInput = true
	}
	if m.CostPerKOutputUSD != nil {
		out.CostPer_1KOutputUsd = *m.CostPerKOutputUSD
		out.HasCostOutput = true
	}
	return out
}

func aiModelUpsertFromProto(p *pb.AIModelUpsert) domain.AIModelUpsert {
	out := domain.AIModelUpsert{
		ModelID: p.ModelId, Label: p.Label, Provider: p.Provider, Tier: p.Tier,
	}
	if p.HasIsEnabled {
		v := p.IsEnabled
		out.IsEnabled = &v
	}
	if p.HasContextWindow {
		v := int(p.ContextWindow)
		out.ContextWindow = &v
	}
	if p.HasCostInput {
		v := p.CostPer_1KInputUsd
		out.CostPerKInputUSD = &v
	}
	if p.HasCostOutput {
		v := p.CostPer_1KOutputUsd
		out.CostPerKOutputUSD = &v
	}
	if p.HasUseForInsight {
		v := p.UseForInsight
		out.UseForInsight = &v
	}
	if p.HasUseForMock {
		v := p.UseForMock
		out.UseForMock = &v
	}
	if p.HasSortOrder {
		v := int(p.SortOrder)
		out.SortOrder = &v
	}
	return out
}
