package ports

import (
	"context"
	"errors"

	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
)

// ─────────────────────────────────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListCompanies(
	ctx context.Context,
	_ *connect.Request[pb.ListCompaniesRequest],
) (*connect.Response[pb.CompanyList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.ListCompaniesUC.Do(ctx)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.CompanyList{Items: make([]*pb.Company, 0, len(list))}
	for _, c := range list {
		out.Items = append(out.Items, toCompanyProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminServer) CreateCompany(
	ctx context.Context,
	req *connect.Request[pb.CreateCompanyRequest],
) (*connect.Response[pb.Company], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	body := req.Msg.GetCompany()
	if body == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("company body required"))
	}
	// proto pb.Company остался с прежним shape (difficulty/min_level_required/
	// sections) — companies переехала на mock-interview shape в DB (см.
	// 00043), но proto не regen'или чтобы не трогать связанные mocks/тесты.
	// Difficulty/MinLevelRequired/Sections с proto-входа игнорируем — куратор
	// заполняет logo_url/description/active через отдельный UI flow (TBD).
	// Для legacy-клиентов default'имся к active=true.
	in := domain.CompanyUpsert{
		Slug:        body.GetSlug(),
		Name:        body.GetName(),
		LogoURL:     "",
		Description: "",
		Active:      true,
	}
	out, err := s.UpsertCompanyUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toCompanyProto(out)), nil
}

// toCompanyProto fills the legacy pb.Company shape с placeholder'ами для
// удалённых полей (Difficulty=normal-default, MinLevelRequired=0, Sections=[]).
// Когда proto будет regen'а на новый shape — заменим на logo_url/active.
func toCompanyProto(c domain.AdminCompany) *pb.Company {
	out := &pb.Company{
		Id:               c.ID.String(),
		Slug:             c.Slug,
		Name:             c.Name,
		Difficulty:       0,
		MinLevelRequired: 0,
	}
	return out
}
