// personas.go — Connect-RPC adapter for the personas bounded context.
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

// PersonaServer satisfies druz9v1connect.PersonaServiceHandler.
type PersonaServer struct {
	ListPersonasUC  *app.ListPersonas
	CreatePersonaUC *app.CreatePersona
	UpdatePersonaUC *app.UpdatePersona
	TogglePersonaUC *app.TogglePersona
	DeletePersonaUC *app.DeletePersona
	Log             *slog.Logger
}

var _ druz9v1connect.PersonaServiceHandler = (*PersonaServer)(nil)

func (s *PersonaServer) ListPersonas(
	ctx context.Context,
	req *connect.Request[pb.ListPersonasRequest],
) (*connect.Response[pb.PersonaList], error) {
	rows, err := s.ListPersonasUC.Do(ctx, req.Msg.ActiveOnly)
	if err != nil {
		s.logErr(ctx, "ListPersonas", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.PersonaList{Items: make([]*pb.Persona, 0, len(rows))}
	for _, p := range rows {
		out.Items = append(out.Items, personaToProto(p))
	}
	return connect.NewResponse(out), nil
}

func (s *PersonaServer) CreatePersona(
	ctx context.Context,
	req *connect.Request[pb.CreatePersonaRequest],
) (*connect.Response[pb.Persona], error) {
	if req.Msg.Persona == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("persona required"))
	}
	out, err := s.CreatePersonaUC.Do(ctx, upsertFromProtoPersona(req.Msg.Persona))
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.logErr(ctx, "CreatePersona", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(personaToProto(out)), nil
}

func (s *PersonaServer) UpdatePersona(
	ctx context.Context,
	req *connect.Request[pb.UpdatePersonaRequest],
) (*connect.Response[pb.Persona], error) {
	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("id required"))
	}
	if req.Msg.Persona == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("persona required"))
	}
	out, err := s.UpdatePersonaUC.Do(ctx, req.Msg.Id, upsertFromProtoPersona(req.Msg.Persona))
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidInput):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "UpdatePersona", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(personaToProto(out)), nil
}

func (s *PersonaServer) TogglePersona(
	ctx context.Context,
	req *connect.Request[pb.TogglePersonaRequest],
) (*connect.Response[pb.TogglePersonaResponse], error) {
	if _, err := s.TogglePersonaUC.Do(ctx, req.Msg.Id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "TogglePersona", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.TogglePersonaResponse{Ok: true}), nil
}

func (s *PersonaServer) DeletePersona(
	ctx context.Context,
	req *connect.Request[pb.DeletePersonaRequest],
) (*connect.Response[pb.DeletePersonaResponse], error) {
	if err := s.DeletePersonaUC.Do(ctx, req.Msg.Id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "DeletePersona", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.DeletePersonaResponse{Ok: true}), nil
}

func (s *PersonaServer) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "personas."+where, slog.Any("err", err))
}

func personaToProto(p domain.Persona) *pb.Persona {
	return &pb.Persona{
		Id: p.ID, Label: p.Label, Hint: p.Hint, IconEmoji: p.IconEmoji,
		BrandGradient: p.BrandGradient, SuggestedTask: p.SuggestedTask,
		SystemPrompt: p.SystemPrompt, SortOrder: int32(p.SortOrder),
		IsEnabled: p.IsEnabled, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

func upsertFromProtoPersona(p *pb.PersonaUpsert) domain.PersonaUpsert {
	sortOrder := int(p.SortOrder)
	enabled := p.IsEnabled
	return domain.PersonaUpsert{
		Label: p.Label, Hint: p.Hint, IconEmoji: p.IconEmoji,
		BrandGradient: p.BrandGradient, SuggestedTask: p.SuggestedTask,
		SystemPrompt: p.SystemPrompt,
		SortOrder:    &sortOrder,
		IsEnabled:    &enabled,
	}
}
